/* eslint-disable curly */


import * as extension from '../extension';
import * as vscode from 'vscode';
import { InitializeNode, initializeOutline } from "../outlineProvider/initialize";
import { OutlineNode, ContainerNode, RootNode } from "./node";
import { OutlineTreeProvider } from "../outlineProvider/outlineTreeProvider";
import * as reorderFunctions from './impl/reorderNodes';
import * as removeFunctions from './impl/removeNodes';
import * as createFunctions from './impl/createNodes';
import * as renameFunctions from './impl/renameNodes';
import { Workspace } from '../workspace/workspaceClass';
import { NodeTypes } from '../outlineProvider/fsNodes';
import * as console from '../vsconsole';
import { registerCommands } from './impl/registerCommands';
import { selectActiveDocument } from './impl/selectActiveDocument';

export class OutlineView extends OutlineTreeProvider<OutlineNode> {

    // Re ordering nodes in the tree
	moveUp = reorderFunctions.moveUp;
	moveDown = reorderFunctions.moveDown;

    // Deleting nodes
	removeResource = removeFunctions.removeResource;

    // Creating nodes
	public newChapter = createFunctions.newChapter;
	public newSnip =  createFunctions.newSnip;
	public newFragment = createFunctions.newFragment;

    // Renaming ndoes
	renameResource = renameFunctions.renameResource;

	registerCommands = registerCommands;

	selectActiveDocument = selectActiveDocument;

	//#region Tree Provider methods
	async initializeTree(): Promise<OutlineNode> {
		const init: InitializeNode<OutlineNode> = (data: NodeTypes<OutlineNode>) => new OutlineNode(data);
        return initializeOutline(init);
    }

	async refresh(reload: boolean): Promise<void> {

		// If the reload option is set to true, the caller wants us to reload the outline tree
		//		completely from disk
		if (reload) {
			this.tree = await this.initializeTree();
		}

		// Because of all the various edits that the outline view does on the internal structure 
		//		and because we want to avoid uneeded reading of the disk file structure, we
		//		send over the outline node to the todo view whenever their is updates
		//		to the outline view tree
		vscode.commands.executeCommand('wt.todo.updateTree', this.tree);

		// Then update the root node of the outline view
		this._onDidChangeTreeData.fire(undefined);
	}

    // Overriding the parent getTreeItem method to add FS API to it
	async getTreeItem (element: OutlineNode): Promise<vscode.TreeItem> {
		const treeItem = await super.getTreeItem(element);
		if (element.data.ids.type === 'fragment') {
			treeItem.command = { 
				command: 'wt.outline.openFile', 
				title: "Open File", 
				arguments: [treeItem.resourceUri], 
			};
			treeItem.contextValue = 'file';
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

	async init (): Promise<void> {
		await this._init();
		this.registerCommands();
	}

    constructor(
        context: vscode.ExtensionContext, 
		protected workspace: Workspace
    ) {
        super(context, 'wt.outline');
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

		// Set up callback for text editor change that displays the opened document in the outline view
		// vscode.window.onDidChangeActiveTextEditor((editor) => this.selectActiveDocument(editor));
		// this.selectActiveDocument(vscode.window.activeTextEditor);
	}
}