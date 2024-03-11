import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as extension from '../extension';
import { Packageable } from '../packageable';
import * as console from '../vsconsole';
import { v4 as uuidv4 } from 'uuid';
import { ResourceType } from './fsNodes';
import { UriBasedView } from './UriBasedView';
import { RecyclingBinView } from '../recyclingBin/recyclingBinView';
import { OutlineNode } from '../outline/node';
import { MoveNodeResult } from '../outline/nodes_impl/handleMovement/common';

export abstract class TreeNode {
	abstract getParentUri(): vscode.Uri;
	abstract getTooltip(): string | vscode.MarkdownString;
	abstract getUri(): vscode.Uri;
	abstract getDisplayString(): string;
	abstract getChildren(filter: boolean): Promise<TreeNode[]>;
	abstract hasChildren(): boolean;
	abstract getDroppableUris(): vscode.Uri[];
	abstract moveNode(
		newParent: TreeNode, 
		provider: OutlineTreeProvider<TreeNode>, 
		moveOffset: number,
		overrideDestination: TreeNode | null
	): Promise<MoveNodeResult>;
}


export abstract class OutlineTreeProvider<T extends TreeNode> 
extends UriBasedView<T>
implements vscode.TreeDataProvider<T>, vscode.TreeDragAndDropController<T>, Packageable {

	protected view: vscode.TreeView<T>;

	// To be implemented by concrete type
	// Builds the initial tree
	abstract initializeTree (): Promise<T>;


	dropMimeTypes = ['application/vnd.code.tree.outline', 'application/vnd.code.tree.recycling', 'text/uri-list'];
	dragMimeTypes = ['text/uri-list'];
	constructor (
		protected context: vscode.ExtensionContext, 
		private viewName: string,
	) {
		super();
		this.view = {} as vscode.TreeView<T>;
		this.uriToVisibility = {};
	}

	abstract init(): Promise<void>;
	async _init (): Promise<void> {
		this.rootNodes = [await this.initializeTree()];

		const view = vscode.window.createTreeView(this.viewName, { 
			treeDataProvider: this, 
			showCollapseAll: true, 
			canSelectMany: true, 
			dragAndDropController: this
		});
		this.view = view;
		this.context.subscriptions.push(view);

		this.initUriExpansion(this.viewName, view, this.context);
	}

	getPackageItems(): { [index: string]: any } {
		return {
			[`${this.viewName}.collapseState`]: this.uriToVisibility
		}
	}

	protected _onDidChangeTreeData: vscode.EventEmitter<T | undefined> = new vscode.EventEmitter<T | undefined>();

	readonly onDidChangeTreeData: vscode.Event<T | undefined> = this._onDidChangeTreeData.event;
	
	abstract refresh(reload: boolean, updates: TreeNode[]): Promise<void>;

	public setOpenedStatusNoUpdate (uri: vscode.Uri, opened: boolean) {
		const usableUri = uri.fsPath.replace(extension.rootPath.fsPath, '');
		this.uriToVisibility[usableUri] = opened;
		// Also save the state of all collapse and expands to workspace context state
		this.context.workspaceState.update(`${this.viewName}.collapseState`, this.uriToVisibility);
	}

	public getOpenedStatusOfNode (uri: vscode.Uri): boolean | undefined {
		const usableUri = uri.fsPath.replace(extension.rootPath.fsPath, '');
		return this.uriToVisibility[usableUri];
	}

	// Tree data provider 

	public async getChildren (element: T): Promise<T[]> {
		if (!this.rootNodes) throw `unreachable`;
		if (!element) {
			return (await this.rootNodes[0].getChildren(true)).map(on => on as T);
		}
		return (await element.getChildren(true)).map(on => on as T);
	}

	public async getParent?(element: T): Promise<T> {
		const parentUri = element.getParentUri();
		return this.getTreeElementByUri(parentUri);
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

    public async handleDrop(target: T | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		const targ = target || this.rootNodes[0];
		if (!targ) throw 'unreachable';

		let overrideDestination: TreeNode | null = null;

		const effectedContainersUriMap: {
			[index: string]: TreeNode,
		} = {};

        const transferOutlineItem = dataTransfer.get('application/vnd.code.tree.outline');
		if (transferOutlineItem) {
			const movedOutlineItems: T[] = transferOutlineItem.value;

			// Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
			const uniqueRoots = await this.getLocalRoots(movedOutlineItems);
			const filteredOutlineParents = uniqueRoots.filter(root => root.getParentUri().toString() !== targ.getUri().toString());


			// Move all the valid nodes into the target
			if (filteredOutlineParents.length > 0) {
				// Offset tells how many nodes have moved downwards in the same container so far
				// In the case where multiple nodes are moving downwards at once, it lets
				//		.moveNode know how many nodes have already moved down, and 
				//		lets it adapt to those changes
				let offset = 0;
				for (const mover of filteredOutlineParents) {
					const moverOutline = mover as any as OutlineNode;
					const res: MoveNodeResult = await moverOutline.generalMoveNode('move', targ, this as any as UriBasedView<OutlineNode>, this, offset, overrideDestination);
					const { moveOffset, createdDestination, effectedContainers } = res;
					if (moveOffset === -1) break;
					offset += moveOffset;

					if (createdDestination) {
						overrideDestination = createdDestination;
					}

					for (const container of effectedContainers) {
						effectedContainersUriMap[container.getUri().fsPath] = container;
					}
				}
			}
		}

		const recyclingTransferItem = dataTransfer.get('application/vnd.code.tree.recycling');
		if (recyclingTransferItem) {

			const recyclingView: RecyclingBinView = await vscode.commands.executeCommand('wt.recyclingBin.getRecyclingBinView');
			const movedItemsJSON: OutlineNode[] = JSON.parse(recyclingTransferItem.value);
			const movedRecyclingItemsRaw: OutlineNode[] = await Promise.all(
				movedItemsJSON.map(mij => {
					const uri = vscode.Uri.file(mij.data.ids.uri.fsPath);
					return recyclingView.getTreeElementByUri(uri);
				})
			);

			// Filter out the dummy node in the recycling tree
			const movedRecyclingItems = movedRecyclingItemsRaw.filter(ri => {
				return !(ri.data.ids.type === 'fragment' && ri.data.ids.parentTypeId === 'root');
			})

			// Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
			const uniqueRecyclingRoots = await recyclingView.getLocalRoots(movedRecyclingItems);
			const filteredRecyclingParents = uniqueRecyclingRoots.filter(root => root.getParentUri().toString() !== targ.getUri().toString());
			
			overrideDestination = null;
	
			// Move all the valid nodes into the target
			if (filteredRecyclingParents.length > 0) {
				for (const mover of filteredRecyclingParents) {
					const res: MoveNodeResult = await mover.generalMoveNode('recover', targ, recyclingView, this, 0, overrideDestination);
					const { moveOffset, createdDestination, effectedContainers } = res;
					if (moveOffset === -1) break;
	
					if (createdDestination) {
						overrideDestination = createdDestination;
					}
	
					for (const container of effectedContainers) {
						if (container === null) continue;
						effectedContainersUriMap[container.getUri().fsPath] = container;
					}
				}
			}
			recyclingView.refresh(false, []);
		}
		
		const allEffectedContainers = Object.entries(effectedContainersUriMap)
			.map(([ _, container ]) => container);
		console.log(allEffectedContainers);
		this.refresh(false, allEffectedContainers);
		
    }
	
    public async handleDrag(source: T[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		treeDataTransfer.set('application/vnd.code.tree.outline', new vscode.DataTransferItem(source));

		const uris: vscode.Uri[] = source.map(src => src.getDroppableUris()).flat();
		const uriStrings = uris.map(uri => uri.toString());
		
		// Combine all collected uris into a single string
		const sourceUriList = uriStrings.join('\r\n');
		treeDataTransfer.set('text/uri-list', new vscode.DataTransferItem(sourceUriList));
	}
}

