import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as extension from '../extension';
import { Packageable } from '../packageable';
import * as console from '../vsconsole';
import { v4 as uuidv4 } from 'uuid';
import { ResourceType } from './fsNodes';
import { UriBasedView } from './UriBasedView';
import { RecyclingBinView } from '../recyclingBin/recyclingBinView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { MoveNodeResult } from '../outline/nodes_impl/handleMovement/common';

export abstract class TreeNode {
	abstract getParentUri(): vscode.Uri;
	abstract getTooltip(): string | vscode.MarkdownString;
	abstract getUri(): vscode.Uri;
	abstract getDisplayString(): string;
	abstract getChildren(filter: boolean): Promise<TreeNode[]>;
	abstract hasChildren(): boolean;
	abstract getDroppableUris(): vscode.Uri[];
	abstract generalMoveNode (
		this: TreeNode,
		operation: 'move' | 'recover',
		newParent: TreeNode, 
		recycleView: UriBasedView<TreeNode>,
		outlineView: OutlineTreeProvider<TreeNode>,
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

	constructor (
		protected context: vscode.ExtensionContext, 
		private viewName: string,
	) {
		super();
		this.view = {} as vscode.TreeView<T>;
		this.uriToVisibility = {};
	}


	dropMimeTypes: string[] = [];
	dragMimeTypes: string[] = [];
	handleDrag?(source: readonly T[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	handleDrop?(target: T | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
		throw new Error('Method not implemented.');
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
}

