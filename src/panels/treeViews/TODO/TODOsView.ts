/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fsFunctions from '../fileSystem/fileSystemProviderFunctions';
import { Workspace } from '../../../workspace/workspace';
import { TODOData, TODONode } from './TODONode';
import { OutlineTreeProvider } from '../outlineTreeProvider';
import { InitializeNode, initializeOutline } from '../initialize';
import { NodeTypes } from '../fsNodes';
import { FileSystem } from '../fileSystem/fileSystem';
import { _ } from '../fileSystem/fileSystemDefault';
import * as console from './../../../vsconsole';

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

export class TODOsView extends OutlineTreeProvider<TODONode> implements vscode.FileSystemProvider, FileSystem {

	private static todoQueriesEnabled: boolean = true;

	disposables: vscode.Disposable[] = [];

    initializeTree(): TODONode {
		const init: InitializeNode<TODONode> = (data: NodeTypes<TODONode>) => new TODONode(data);
        return initializeOutline<TODONode>(init);
    }

    // File system functions
	watch = fsFunctions.watch;
	stat = fsFunctions.stat;
	readDirectory = fsFunctions.readDirectory;
	createDirectory = fsFunctions.createDirectory;
	readFile = fsFunctions.readFile;
	writeFile = fsFunctions.writeFile;
	delete = fsFunctions.deleteFile;
	rename = fsFunctions.renameFile;

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

		vscode.commands.registerCommand('wt.wordWatcher.enable', () => {
            vscode.commands.executeCommand('wt.wordWatcher.enabled', true);
            TODOsView.todoQueriesEnabled = true;

			// Do a refresh right away to gather all the TODOs that might have been missed while querying was disabled
            vscode.commands.executeCommand('wt.wordWatcher.refresh', true);
        });

        vscode.commands.registerCommand('wt.wordWatcher.disable', () => {
            vscode.commands.executeCommand('wt.wordWatcher.enabled', false);
            TODOsView.todoQueriesEnabled = false;
        });
    }

    // Overriding the parent getTreeItem method to add FS API to it
	getTreeItem(element: TODONode): vscode.TreeItem {
		const treeItem = super.getTreeItem(element);
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

	
    // Updates the decorations for watched words -- colors them in a little red box
    private activeEditor: vscode.TextEditor | undefined;
    
	private async refreshTextNode (): Promise<void> {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) return;
		
		const document = activeEditor.document;
		
		let uri: vscode.Uri | undefined = document.uri;
		let editedNode: TODONode | undefined | null = this._getTreeElementByUri(uri);
		
		if (!editedNode) {
			await vscode.commands.executeCommand('wt.todo.refresh');
		}

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
			editedNode = this._getTreeElement(parentId);
			uri = editedNode?.getUri();
		}

		// Refresh all invalidated nodes on the tree
		this.refresh();
	}

    private timeout: NodeJS.Timer | undefined = undefined;
	private triggerTODOUpdates (throttle = false) {
		if (!TODOsView.todoQueriesEnabled) return;

		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = undefined;
		}
		if (throttle) {
			this.timeout = setTimeout(() => this.refreshTextNode(), 500);
		} else {
			this.refreshTextNode();
		}
	}

	_onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

    constructor(
        context: vscode.ExtensionContext, 
		protected workspace: Workspace
    ) {
        super(context, 'wt.todo');
        this.registerCommands();

		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

		// If there is an active editor, then trigger decarator updates off the bat
        this.activeEditor = vscode.window.activeTextEditor;
        if (this.activeEditor) {
            this.triggerTODOUpdates();
        }
    
        // If the active editor changed, then change the internal activeEditor value and trigger decarator updates
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.activeEditor = editor;
            if (editor) {
                this.triggerTODOUpdates();
            }
        }, null, context.subscriptions);
    
        // On text document change within the editor, update decorations with throttle
        vscode.workspace.onDidChangeTextDocument(event => {
            if (this.activeEditor && event.document === this.activeEditor.document) {
                this.triggerTODOUpdates(true);
            }
        }, null, context.subscriptions);

		// TOTEST
		// Enable todo querying
		vscode.commands.registerCommand('wt.todo.enabled', true);
	}
}