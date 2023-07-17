import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as extension from '../extension';
import { Packageable } from '../packageable';
import * as console from '../vsconsole';
import { v4 as uuidv4 } from 'uuid';
import { ResourceType } from './fsNodes';

export abstract class TreeNode {
	abstract getParentUri(): vscode.Uri;
	abstract getTooltip(): string | vscode.MarkdownString;
	abstract getUri(): vscode.Uri;
	abstract getDisplayString(): string;
	abstract getChildren(filter: boolean): Promise<TreeNode[]>;
	abstract hasChildren(): boolean;
	abstract moveNode(newParent: TreeNode, provider: OutlineTreeProvider<TreeNode>, moveOffset: number): Promise<number>;
}


export abstract class OutlineTreeProvider<T extends TreeNode> 
implements vscode.TreeDataProvider<T>, vscode.TreeDragAndDropController<T>, Packageable {
	private uriToVisibility: { [index: string]: boolean };

    public tree: T;
	protected view: vscode.TreeView<T>;

	// To be implemented by concrete type
	// Builds the initial tree
	abstract initializeTree (): Promise<T>;

	constructor (
		protected context: vscode.ExtensionContext, 
		private viewName: string,
	) {
		this.view = {} as vscode.TreeView<T>;
		this.tree = {} as T;
		this.uriToVisibility = {};
	}

	abstract init(): Promise<void>;
	async _init (): Promise<void> {
		this.tree = await this.initializeTree();
		const uriMap: { [index: string]: boolean } | undefined = this.context.workspaceState.get(`${this.viewName}.collapseState`);
		if (uriMap) {
			this.uriToVisibility = uriMap;
		}
		else { 
			this.uriToVisibility = {};
		}

		const view = vscode.window.createTreeView(this.viewName, { 
			treeDataProvider: this, 
			showCollapseAll: true, 
			canSelectMany: true, 
			dragAndDropController: this
		});
		this.view = view;
		this.context.subscriptions.push(view);

		// Functions for storing the state of a uri's collapse/expands whenever a tree is closed 
		//		or opened
		view.onDidExpandElement((event: vscode.TreeViewExpansionEvent<T>) => {
			const expandedElementUri = event.element.getUri();
			const usableUri = expandedElementUri.fsPath.replace(extension.rootPath.fsPath, '');
			this.uriToVisibility[usableUri] = true;
			// Also save the state of all collapse and expands to workspace context state
			this.context.workspaceState.update(`${this.viewName}.collapseState`, this.uriToVisibility);
		});

		view.onDidCollapseElement((event: vscode.TreeViewExpansionEvent<T>) => {
			const collapsedElementUri = event.element.getUri();
			const usableUri = collapsedElementUri.fsPath.replace(extension.rootPath.fsPath, '');
			this.uriToVisibility[usableUri] = false;			
			this.context.workspaceState.update(`${this.viewName}.collapseState`, this.uriToVisibility);
		});
	}

	getPackageItems(): { [index: string]: any } {
		return {
			[`${this.viewName}.collapseState`]: this.uriToVisibility
		}
	}

	protected _onDidChangeTreeData: vscode.EventEmitter<T | undefined> = new vscode.EventEmitter<T | undefined>();

	readonly onDidChangeTreeData: vscode.Event<T | undefined> = this._onDidChangeTreeData.event;
	
	abstract refresh(reload: boolean): Promise<void>;

	// Tree data provider 

	public async getChildren (element: T): Promise<T[]> {
		if (!element) {
			return (await this.tree.getChildren(true)).map(on => on as T);
		}
		return (await element.getChildren(true)).map(on => on as T);
	}

	public async getParent?(element: T): Promise<T> {
		const parentUri = element.getParentUri();
		return this._getTreeElementByUri(parentUri);
	}

	public async getTreeItem (element: T): Promise<vscode.TreeItem> {
		return this._getTreeItem(element);
	}


	// nothing to dispose
	dispose (): void {}

	// Helper methods
	
	async _getTreeItem (treeElement: T): Promise<vscode.TreeItem> {
		const label = treeElement.getDisplayString();

		let collapseState: vscode.TreeItemCollapsibleState;
		if (treeElement.hasChildren()) {
			// If the tree element has children, look that element up in the uri map to find the collapsability
			const uri = treeElement.getUri();
			const usableUri = uri.fsPath.replace(extension.rootPath.fsPath, '');
			const isCollapsed: boolean | undefined = this.uriToVisibility[usableUri];
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
			id: uuidv4(),

			label: /**vscode.TreeItemLabel**/<any>{ 
				label: label
            },
			// An example of how to use codicons in a MarkdownString in a tree item tooltip.
			tooltip: treeElement.getTooltip(),
			collapsibleState: collapseState,
			resourceUri: treeElement.getUri(),
		};
	}

	
	async _getTreeElementByUri (targetUri: vscode.Uri | undefined, tree?: TreeNode, filter?: boolean): Promise<any> {
		// If there is not targeted key, then assume that the caller is targeting
		//		the entire tree
		if (!targetUri) {
			return this.tree;
		}
		
		// If there is no provided tree, use the whole tree as the search space
		const currentNode = tree ?? this.tree;
		if (!currentNode.getChildren) return null;
		const currentChildren = await currentNode.getChildren(!!filter);

		if (currentNode.getUri().fsPath === targetUri.fsPath) {
			return currentNode as T;
		}
		// Iterate over all keys-value mappings in the current node
		for (const subtree of currentChildren) {
			const subtreeId = subtree.getUri().fsPath;

			// If the current key matches the targeted key, return the value mapping
			if (subtreeId === targetUri.fsPath) {
				return subtree as T;
			} 
			// Otherwise, recurse into this function again, using the current
			//		subtree as the search space
			else {
				const treeElement = await this._getTreeElementByUri(targetUri, subtree, filter);
				
				// If the tree was found, return it
				if (treeElement) {
					return treeElement;
				}
			}
		}

		return null;
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
        const uniqueRoots = await this._getLocalRoots(movedItems);
		const filteredParents = uniqueRoots.filter(root => root.getParentUri().toString() !== targ.getUri().toString());

		// Move all the valid nodes into the target
		if (filteredParents.length > 0) {
			// Offset tells how many nodes have moved downwards in the same container so far
			// In the case where multiple nodes are moving downwards at once, it lets
			//		.moveNode know how many nodes have already moved down, and 
			//		lets it adapt to those changes
			let offset = 0;
			for (const mover of filteredParents) {
				offset += await mover.moveNode(targ, this, offset);
			}
			this.refresh(false);
		}
    }
    public async handleDrag(source: T[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		treeDataTransfer.set('application/vnd.code.tree.outline', new vscode.DataTransferItem(source));
	}


	// From the given nodes, filter out all nodes who's parent is already in the the array of Nodes.
	async _getLocalRoots (nodes: T[]): Promise<T[]> {
		const localRoots: T[] = [];
		for (let i = 0; i < nodes.length; i++) {
			const parentId = nodes[i].getParentUri();
			const parent = await this._getTreeElementByUri(parentId);
			if (parent) {
				const isInList = nodes.find(n => n.getUri().toString() === parent.getUri().toString());
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

