/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
// import * as console from '../vsconsole';
import { Workspace } from '../workspace/workspaceClass';
import { TODOData, TODONode } from './node';
import { OutlineTreeProvider } from '../outlineProvider/outlineTreeProvider';
import { InitializeNode, initializeOutline } from '../outlineProvider/initialize';
import { Timed } from '../timedView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { ChapterNode, ContainerNode, FragmentNode, NodeTypes, RootNode, SnipNode } from '../outlineProvider/fsNodes';
import { update } from './impl/timerFunctions';
import { disable } from '../wordWatcher/timer';
import { registerCommands } from './impl/registerCommands';
import { getTODOCounts } from './nodes_impl/getTODOCounts';
import { ExtensionGlobals } from '../extension';
import { getFsPathKey, setFsPathKey } from '../help';

export type TODO = {
	rowStart: number,
	rowEnd: number,
	colStart: number,
	colEnd: number,
	preview: string
};

export type Validation = {
	type: 'todos',
	data: TODO[] 
} | {
	type: 'count',
	data: number
} | {
	type: 'invalid'
};

type TODOInfo = { [index: string]: Validation };
// export const todo: TODOInfo = {};

export class TODOsView extends OutlineTreeProvider<TODONode> implements Timed {
	
	static todo: TODOInfo = {};
	isInvalidated = (uri: vscode.Uri): boolean => {
		const todoLog = getFsPathKey<Validation>(uri, TODOsView.todo);;
		return !todoLog || todoLog.type === 'invalid';
	};
	
	static getTODO = (uri: vscode.Uri): Validation => {
		const data = getFsPathKey<Validation>(uri, this.todo)!;
		if (data.type === 'invalid') {
			vscode.window.showWarningMessage(`Error: uri was not validated before calling getTODO.  This is my fault.  Please message me and call me and idiot if you see this.`);
			throw new Error('Make sure to validate your uri before calling getTODO!');
		}
		return data;
	};
	
	async invalidateNode (
		currentUri: vscode.Uri | undefined,
		currentNode: TODONode | null | undefined
	) {
		const pathsToInvalidate: vscode.Uri[] = [];
	
		// Traverse upwards from the current node and invalidate it as well as all of its
		//		parents
		while (currentNode && currentUri) {
			// Invalidate the current node
			pathsToInvalidate.push(currentUri);
			
			// Break once the root node's records have been removed
			if (currentNode.data.ids.type === 'root') {
				break;
			}
	
			// Traverse upwards
			const parentUri: vscode.Uri = currentNode.data.ids.parentUri;
			currentNode = await this.getTreeElementByUri(parentUri);
			currentUri = currentNode?.getUri();
		};
		pathsToInvalidate.forEach(currentUri => setFsPathKey<Validation>(currentUri, { type: 'invalid' }, TODOsView.todo));
	}
	
	enabled: boolean = false;
	update = update;
	disable = disable;

	//#region outline tree provider
	disposables: vscode.Disposable[] = [];
    async initializeTree(): Promise<TODONode> {
		const init: InitializeNode<TODONode> = (data: NodeTypes<TODONode>) => new TODONode(data);
        return initializeOutline<TODONode>(init);
    }

	async refresh(reload: boolean, updates: TODONode[]): Promise<void> {
		if (reload) {
			this.rootNodes = [await this.initializeTree()];
		}
		await this.rootNodes[0].getTODOCounts();
		return this._onDidChangeTreeData.fire(undefined);
	}

    // Overriding the parent getTreeItem method to add FS API to it
	async getTreeItem(element: TODONode): Promise<vscode.TreeItem> {
		const treeItem = await super.getTreeItem(element);
		if (element.data.ids.type === 'fragment') {
			if (element.data.ids.type === 'fragment' && element.data.ids.parentTypeId === 'fragment') {
				// Fragments with an internal id of 'dummy' are TODO nodes
				// They store TODO data and when clicked they should open into the tree where
				//		the TODO string was found

				// Convert generic node data to a TODONode
				const asTODO: TODOData = element.data as TODOData;
				const todoData = asTODO.todo;

				treeItem.command = { 
					command: 'wt.todo.openFile', 
					title: "Open File", 
					// Pass the resource url to the fragment and the 
					arguments: [treeItem.resourceUri, todoData], 
				};
				treeItem.contextValue = 'file';
			}
			else {
				// Fragments whose internal ids are not 'dummy' are actual fragments
				// In the TODO tree, fragments are actually treated as folders, so 
				//		they cannot be clicked and opened like they can in the outline
				//		view
				treeItem.contextValue = 'dir';
				treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
			}
		}
		else if (element.data.ids.type === 'container') {
			treeItem.contextValue = 'container';
		}
		else {
			treeItem.contextValue = 'dir';
		}

		// Add the icon, depending on whether this node represents a folder or a text fragment
		const icon = element.data.ids.type === 'fragment'
			? 'edit'
			: 'symbol-folder';

		treeItem.iconPath = new vscode.ThemeIcon(icon);
		return treeItem;
	}

	
	_onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}
	//#endregion

    // Register all the commands needed for the outline view to work
    registerCommands = registerCommands;

	constructor(context: vscode.ExtensionContext, protected workspace: Workspace) {
        super(context, 'wt.todo');
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
		ExtensionGlobals.todoView = this;
	}

	async init (): Promise<void> {
		await this._init();
		this.registerCommands();
		this.enabled = false;
	}
}