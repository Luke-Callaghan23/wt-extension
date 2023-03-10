/* eslint-disable curly */
import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { Workspace } from '../workspace/workspace';
import { TODOData, TODONode } from './TODONode';
import { OutlineTreeProvider } from '../outlineProvider/outlineTreeProvider';
import { InitializeNode, initializeOutline } from '../outlineProvider/initialize';
import { NodeTypes } from '../outlineProvider/fsNodes';
import { Timed } from '../timedView';

export type TODO = {
	rowStart: number,
	rowEnd: number,
	colStart: number,
	colEnd: number,
	preview: string
};
export type Validated = {
	type: 'todos',
	data: TODO[] 
} | {
	type: 'count',
	data: number
};
type Invalid = null;
type TODOInfo = { [index: string]: Validated | Invalid };

type TODONodeMap = { [index: string]: TODONode[] };

export const todo: TODOInfo = {};
export const todoNodes: TODONodeMap = {};
export const invalid = null;
export const isInvalidated: (uri: string) => boolean = (uri: string) => {
	const todoLog = todo[uri];
	return todoLog === invalid || todoLog === undefined;
};
export const getTODO: (uri: string) => Validated = (uri: string) => {
	const data = todo[uri];
	if (!data) {
		vscode.window.showWarningMessage(`Error: uri was not validated before calling getTODO.  This is my fault.  Please message me and call me and idiot if you see this.`);
		throw new Error('Make sure to validate your uri before calling getTODO!');
	}
	return data;
};
export function getTODONodes (fragmentUri: string): TODONode[] {
	return todoNodes[fragmentUri];
}

export class TODOsView extends OutlineTreeProvider<TODONode> implements Timed {

	//#region outline tree provider
	disposables: vscode.Disposable[] = [];
    async initializeTree(): Promise<TODONode> {
		const init: InitializeNode<TODONode> = (data: NodeTypes<TODONode>) => new TODONode(data);
        return initializeOutline<TODONode>(init);
    }

    // Overriding the parent getTreeItem method to add FS API to it
	async getTreeItem(element: TODONode): Promise<vscode.TreeItem> {
		const treeItem = await super.getTreeItem(element);
		if (element.data.ids.type === 'fragment') {
			if (element.data.ids.internal.startsWith('dummy')) {
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

    constructor(
        context: vscode.ExtensionContext, 
		protected workspace: Workspace
    ) {
        super(context, 'wt.todo');
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	}

	async init (): Promise<void> {
		await this._init();
		this.registerCommands();
		this.enabled = true;
	}

	//#region Timed methods
	enabled: boolean = false;
	async update (editor: vscode.TextEditor): Promise<void> {
		const document = editor.document;
		
		let uri: vscode.Uri | undefined = document.uri;
		let editedNode: TODONode | undefined | null = await this._getTreeElementByUri(uri);
		
		if (!editedNode) {
			await vscode.commands.executeCommand('wt.todo.refresh');
		}

		// Traverse upwards from the current node and invalidate it as well as all of its
		//		parents
		while (editedNode && uri) {
			// Invalidate the current node
			todo[uri.fsPath] = invalid;
			delete todoNodes[uri.fsPath];
			
			// Break once the root node's records have been removed
			if (editedNode.data.ids.type === 'root') {
				break;
			}

			// Traverse upwards
			const parentId = editedNode.data.ids.parentInternalId;
			editedNode = await this._getTreeElement(parentId);
			uri = editedNode?.getUri();
		}

		// Refresh all invalidated nodes on the tree
		this.refresh();
	}

	async disable?(): Promise<void> {
		vscode.commands.executeCommand('wt.todo.refresh', true);
	}
	//#endregion

    // Register all the commands needed for the outline view to work
    registerCommands() {
        vscode.commands.registerCommand('wt.todo.openFile', (resourceUri: vscode.Uri, todoData: TODO) => {
			// Create a range object representing where the TODO lies on the document
			const textDocumentRange = new vscode.Range (
				todoData.rowStart,		// start line
				todoData.colStart,		// start character
				todoData.rowEnd,		// end line
				todoData.colEnd,		// end character
			);

			// Open the document
			vscode.window.showTextDocument(resourceUri, { selection: textDocumentRange });
		});

		vscode.commands.registerCommand('wt.todo.refresh', () => {
			Object.getOwnPropertyNames(todo).forEach(uri => {
				todo[uri] = invalid;
			});
			Object.getOwnPropertyNames(todoNodes).forEach(uri => {
				delete todoNodes[uri];
			});
			this.refresh();
		});

		vscode.commands.registerCommand('wt.todo.help', () => {
			vscode.window.showInformationMessage(`TODOs`, {
                modal: true,
                detail: `The TODO panel is an area that logs all areas you've marked as 'to do' in your work.  The default (and only (for now)) way to mark a TODO in your work is to enclose the area you want to mark with square brackets '[]'`
            }, 'Okay');
		});
    }
}