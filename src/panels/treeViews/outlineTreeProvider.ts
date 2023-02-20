import * as vscode from 'vscode';
import * as extension from '../../extension';
import * as console from '../../vsconsole';

export abstract class TreeNode {
	abstract getParentId(): string;
	abstract getTooltip(): string | vscode.MarkdownString;
	abstract getUri(): string;
	abstract getDisplayString(): string;
	abstract getId(): string;
	abstract getChildren(): TreeNode[];
	abstract hasChildren(): boolean;
	abstract moveNode(newParent: TreeNode, provider: OutlineTreeProvider<TreeNode>): boolean;
}

let uriToVisibility: { [index: string]: boolean };

export abstract class OutlineTreeProvider<T extends TreeNode> implements vscode.TreeDataProvider<T>, vscode.TreeDragAndDropController<T> {

    public tree: T;
	protected view: vscode.TreeView<T>;

	// To be implemented by concrete type
	// Builds the initial tree
	abstract initializeTree (): T;

	constructor (
		protected context: vscode.ExtensionContext, 
		viewName: string
	) {
		this.tree = this.initializeTree();

		const uriMap: { [index: string]: boolean } | undefined = context.workspaceState.get('collapseState');
		if (uriMap) {
			uriToVisibility = uriMap;
		}
		else { 
			uriToVisibility = {};
		}

		const view = vscode.window.createTreeView(viewName, { 
            treeDataProvider: this, 
            showCollapseAll: true, 
            canSelectMany: true, 
			dragAndDropController: this
		});
		this.view = view;
		context.subscriptions.push(view);

		// Functions for storing the state of a uri's collapse/expands whenever a tree is closed 
		//		or opened
		view.onDidExpandElement((event: vscode.TreeViewExpansionEvent<T>) => {
			const expandedElementUri = event.element.getUri();
			uriToVisibility[expandedElementUri] = true;
			// Also save the state of all collapse and expands to workspace context state
			context.workspaceState.update('collapseState', uriToVisibility);
		});

		view.onDidCollapseElement((event: vscode.TreeViewExpansionEvent<T>) => {
			const collapsedElementUri = event.element.getUri();
			uriToVisibility[collapsedElementUri] = false;			
			context.workspaceState.update('collapseState', uriToVisibility);
		});	
	}

	private _onDidChangeTreeData: vscode.EventEmitter<T | undefined> = new vscode.EventEmitter<T | undefined>();

	readonly onDidChangeTreeData: vscode.Event<T | undefined> = this._onDidChangeTreeData.event;
	
	refresh(): void {
		this.tree = this.initializeTree();
		this._onDidChangeTreeData.fire(undefined);
	}

	// Tree data provider 

	public getChildren (element: T): T[] {
		if (!element) {
			return this.tree.getChildren().map(on => on as T);
		}
		return element.getChildren().map(on => on as T);
	}

	public getTreeItem (element: T): vscode.TreeItem {
		return this._getTreeItem(element.getId());
	}


	// nothing to dispose
	dispose (): void {}

	// Helper methods
	
	_getTreeItem (key: string): vscode.TreeItem {
		const treeElement = this._getTreeElement(key) as T;
		const label = treeElement.getDisplayString();

		let collapseState: vscode.TreeItemCollapsibleState;
		if (treeElement.hasChildren()) {
			// If the tree element has children, look that element up in the uri map to find the collapsability
			const isCollapsed: boolean | undefined = uriToVisibility[treeElement.getUri()];
			if (isCollapsed === undefined || isCollapsed === false) {
				collapseState = vscode.TreeItemCollapsibleState.Collapsed;
			}
			else {
				collapseState = vscode.TreeItemCollapsibleState.Expanded;
			}
		}
		else {
			// If the element has no children, then don't give it any collapse-ability
			collapseState = vscode.TreeItemCollapsibleState.None;
		}

		return {
			id: key,

			label: /**vscode.TreeItemLabel**/<any>{ 
				label: label
            },
			// An example of how to use codicons in a MarkdownString in a tree item tooltip.
			tooltip: treeElement.getTooltip(),
			collapsibleState: collapseState,
			resourceUri: vscode.Uri.parse(treeElement.getUri()),
		};
	}

	// Searches provided tree for the object whose key matches the targeted key
	_getTreeElement (targetkey: string | undefined, tree?: TreeNode): any {
		// If there is not targeted key, then assume that the caller is targeting
		//		the entire tree
		if (!targetkey) {
			return this.tree;
		}

		// If there is no provided tree, use the whole tree as the search space
		const currentNode = tree ?? this.tree;
		const currentChildren = currentNode.getChildren();

		if (currentNode.getId() === targetkey) {
			return currentNode;
		}
		
		// Iterate over all keys-value mappings in the current node
		for (const subtree of currentChildren) {
			const subtreeId = subtree.getId();

			// If the current key matches the targeted key, return the value mapping
			if (subtreeId === targetkey) {
				return subtree;
			} 
			// Otherwise, recurse into this function again, using the current
			//		subtree as the search space
			else {
				const treeElement = this._getTreeElement(targetkey, subtree);
				
				// If the tree was found, return it
				if (treeElement) {
					return treeElement;
				}
			}
		}
	}

	_getTreeElementByUri (targetUri: string | undefined, tree?: TreeNode): any {
		// If there is not targeted key, then assume that the caller is targeting
		//		the entire tree
		if (!targetUri) {
			return this.tree;
		}
		
		// If there is no provided tree, use the whole tree as the search space
		const currentNode = tree ?? this.tree;
		const currentChildren = currentNode.getChildren();

		if (currentNode.getUri() === targetUri) {
			return currentNode;
		}
		
		// Iterate over all keys-value mappings in the current node
		for (const subtree of currentChildren) {
			const subtreeId = subtree.getUri();

			// If the current key matches the targeted key, return the value mapping
			if (subtreeId === targetUri) {
				return subtree;
			} 
			// Otherwise, recurse into this function again, using the current
			//		subtree as the search space
			else {
				const treeElement = this._getTreeElementByUri(targetUri, subtree);
				
				// If the tree was found, return it
				if (treeElement) {
					return treeElement;
				}
			}
		}
	}


	dropMimeTypes = ['application/vnd.code.tree.outline'];
    dragMimeTypes = ['text/uri-list'];

    public async handleDrop(target: T | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		const targ = target || this.tree;
        const transferItem = dataTransfer.get('application/vnd.code.tree.outline');
		if (!transferItem) {
			return;
		}
		const movedItems: T[] = transferItem.value;

		// Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
        const uniqueRoots = this._getLocalRoots(movedItems);
		const filteredParents = uniqueRoots.filter(root => root.getParentId() !== targ.getId());

		// Move all the valid nodes into the target
		if (filteredParents.length > 0) {
			filteredParents.forEach(mover => {
				mover.moveNode(targ, this);
			});
			this.refresh();
		}
    }
    public async handleDrag(source: T[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		treeDataTransfer.set('application/vnd.code.tree.outline', new vscode.DataTransferItem(source));
	}


	// From the given nodes, filter out all nodes who's parent is already in the the array of Nodes.
	_getLocalRoots (nodes: T[]): T[] {
		const localRoots = [];
		for (let i = 0; i < nodes.length; i++) {
			const parentId = nodes[i].getParentId();
			const parent = this._getTreeElement(parentId);
			if (parent) {
				const isInList = nodes.find(n => n.getId() === parent.getId());
				if (isInList === undefined) {
					localRoots.push(nodes[i]);
				}
			} else {
				localRoots.push(nodes[i]);
			}
		}
		return localRoots;
	}
}

