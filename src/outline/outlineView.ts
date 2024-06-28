/* eslint-disable curly */


import * as extension from '../extension';
import * as vscode from 'vscode';
import { InitializeNode, initializeOutline } from "../outlineProvider/initialize";
import { OutlineNode, ContainerNode, RootNode } from "./nodes_impl/outlineNode";
import { OutlineTreeProvider } from "../outlineProvider/outlineTreeProvider";
import * as removeFunctions from './impl/removeNodes';
import * as createFunctions from './impl/createNodes';
import * as renameFunctions from './impl/renameNodes';
import { Workspace } from '../workspace/workspaceClass';
import { NodeTypes } from '../outlineProvider/fsNodes';
import * as console from '../vsconsole';
import * as commands from './impl/registerCommands';
import * as activeDocuments from './impl/selectActiveDocument';
import * as  copyPaste from './impl/copyPaste';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { MoveNodeResult } from './nodes_impl/handleMovement/common';
import { RecyclingBinView, Renamable } from '../recyclingBin/recyclingBinView';
import { handleDragController, handleDropController } from './impl/dragDropController';

export class OutlineView extends OutlineTreeProvider<OutlineNode> implements Renamable<OutlineNode> {
    // Deleting nodes
	removeResource = removeFunctions.removeResource;

    // Creating nodes
	public newChapter = createFunctions.newChapter;
	public newSnip =  createFunctions.newSnip;
	public newFragment = createFunctions.newFragment;

    // Renaming ndoes
	renameResource = renameFunctions.renameResource;

	// Copy and pasting files
	copy = copyPaste.copy;
	paste = copyPaste.paste;

	// Misc
	registerCommands = commands.registerCommands;
	selectActiveDocument = activeDocuments.selectActiveDocument;

	//#region Tree Provider methods
	async initializeTree(): Promise<OutlineNode> {
		const init: InitializeNode<OutlineNode> = (data: NodeTypes<OutlineNode>) => new OutlineNode(data);
        return initializeOutline(init);
    }

	async refresh(reload: boolean, updates: OutlineNode[]): Promise<void> {

		// If the reload option is set to true, the caller wants us to reload the outline tree
		//		completely from disk
		if (reload) {
			this.rootNodes = [await this.initializeTree()];
		}

		// Because of all the various edits that the outline view does on the internal structure 
		//		and because we want to avoid uneeded reading of the disk file structure, we
		//		send over the outline node to the todo view whenever their is updates
		//		to the outline view tree
		vscode.commands.executeCommand('wt.todo.updateTree', this.rootNodes);

		// If there are specific nodes to update from the callee, then fire tree data updates
		//		on those one at a time
		if (updates.length > 0) {
			// No clue why this is necessary but when doing multiple updates sometimes the second/third/fifth update 
			//		kills the children created by earlier updates (gruesome, ik)
			// Reversing the updates seems to fix this for some reason
			updates.reverse();
			for (const update of updates) {
				this._onDidChangeTreeData.fire(update);
			}
		}
		// No specific updates specified by the callee -> refresh the whole tree
		else {
			this._onDidChangeTreeData.fire(undefined);
		}
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
        protected context: vscode.ExtensionContext, 
		public workspace: Workspace
    ) {
        super(context, 'wt.outline');
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

		// Set up callback for text editor change that displays the opened document in the outline view
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (this.view.visible) {
				setTimeout(() => {
					this.selectActiveDocument(editor);
				}, 0)
			}
		});
	}
	
	dropMimeTypes = ['application/vnd.code.tree.outline', 'application/vnd.code.tree.recycling', 'application/vnd.code.tree.scratch', 'text/uri-list'];
	dragMimeTypes = ['text/uri-list'];

	dragController = handleDragController;
	handleDrag (source: OutlineNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
		return this.dragController(source, dataTransfer, token);
	}

	dropController = handleDropController;
	handleDrop(target: OutlineNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
		if (!target) return;
		return this.dropController(target, dataTransfer, token);
	}
}