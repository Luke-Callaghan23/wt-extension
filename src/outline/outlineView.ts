/* eslint-disable curly */


import * as extension from '../extension';
import * as vscode from 'vscode';
import { InitializeNode, initializeOutline } from "../outlineProvider/initialize";
import { OutlineNode, ContainerNode, RootNode } from "./nodes_impl/outlineNode";
import { OutlineTreeProvider } from "../outlineProvider/outlineTreeProvider";
import * as removeFunctions from './impl/removeNodes';
import * as createFunctions from './impl/createNodes';
import * as renameFunctions from './impl/renameNodes';
import * as editDescriptionFunctions from './impl/editNodeDescription';
import { Workspace } from '../workspace/workspaceClass';
import { NodeTypes } from '../outlineProvider/fsNodes';
import * as console from '../miscTools/vsconsole';
import * as commands from './impl/registerCommands';
import * as activeDocuments from './impl/selectActiveDocument';
import * as  copyPaste from './impl/copyPaste';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { MoveNodeResult } from './nodes_impl/handleMovement/common';
import { RecyclingBinView, Renamable } from '../recyclingBin/recyclingBinView';
import { handleDragController, handleDropController } from './impl/dragDropController';
import { TODOsView } from '../TODO/TODOsView';
import * as search from '../miscTools/searchFiles';
import { NodeMoveKind } from './nodes_impl/handleMovement/generalMoveNode';
import { defaultProgress, getRelativePath, RevealOptions } from '../miscTools/help';

export class OutlineView extends OutlineTreeProvider<OutlineNode> implements Renamable<OutlineNode> {
    // Deleting nodes
	removeResource = removeFunctions.removeResource;

    // Creating nodes
	public newChapter = createFunctions.newChapter;
	public newSnip =  createFunctions.newSnip;
	public newFragment = createFunctions.newFragment;

    // Editing node visual data
	renameResource = renameFunctions.renameResource;
	editNodeDescription = editDescriptionFunctions.editNodeDescription;
	editNodeMarkdownDescription = editDescriptionFunctions.editNodeMarkdownDescription;

	// Copy and pasting files
	copy = copyPaste.copy;
	paste = copyPaste.pasteNew;

	// Misc
	registerCommands = commands.registerCommands;
	selectActiveDocument = activeDocuments.selectActiveDocument;

	//#region Tree Provider methods
	async initializeTree(): Promise<OutlineNode> {
		const init: InitializeNode<OutlineNode> = (data: NodeTypes<OutlineNode>) => new OutlineNode(data);
        return initializeOutline(OutlineView.viewId, init);
    }

	async refresh(reload: boolean, updates: OutlineNode[], skipTodosUpdate: boolean = false): Promise<void> {

		// If the reload option is set to true, the caller wants us to reload the outline tree
		//		completely from disk
		if (reload) {
			this.rootNodes = [await this.initializeTree()];
			TODOsView.clearTodos();
		}

		if (updates.length !== 0 && !skipTodosUpdate) {
			// Because of all the various edits that the outline view does on the internal structure 
			//		and because we want to avoid uneeded reading of the disk file structure, we
			//		send over the outline node to the todo view whenever their is updates
			//		to the outline view tree
			vscode.commands.executeCommand('wt.todo.updateTree', this.rootNodes, updates);
		}

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

	static viewId: string = 'wt.outline';
    constructor(
        protected context: vscode.ExtensionContext, 
		public workspace: Workspace
    ) {
        super(context, OutlineView.viewId, "Outline");
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
		this.context.subscriptions.push(this._onDidChangeFile)
		this.context.subscriptions.push(this._onDidChangeTreeData)

		// Set up callback for text editor change that displays the opened document in the outline view
		this.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (this.view.visible) {
				setTimeout(() => {
					this.selectActiveDocument(editor);
				}, 0)
			}
		}));
	}
	
	dropMimeTypes = ['application/vnd.code.tree.outline', 'application/vnd.code.tree.recycling', 'application/vnd.code.tree.scratch', 'text/uri-list'];
	dragMimeTypes = ['text/uri-list'];

	dragController = handleDragController;
	handleDrag (source: OutlineNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
		return this.dragController("application/vnd.code.tree.outline", source, dataTransfer, token);
	}

	dropController = handleDropController;
	handleDrop(target: OutlineNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
		if (!target) return;
		return this.dropController(target, dataTransfer, token);
	}

	
	copyRelativePath (resource: OutlineNode) {
		vscode.env.clipboard.writeText(resource.data.ids.uri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/'));
		vscode.window.showInformationMessage(`[INFO] Successfully copied relative path for '${resource.data.ids.display}'`);
	}

	copyPath (resource: OutlineNode) {
		vscode.env.clipboard.writeText(resource.data.ids.uri.fsPath);
		vscode.window.showInformationMessage(`[INFO] Successfully copied path for '${resource.data.ids.display}'`);
	}

	async manualMove (resource: OutlineNode, nodeMoveKind: NodeMoveKind='move') {
		const chose = await this.selectFile([ (node) => {
			return node.data.ids.type !== 'fragment'
		} ]);
		if (chose === null) return;
		if (chose.data.ids.type === 'root') return;
		
		const moveResult = await resource.generalMoveNode(nodeMoveKind, chose, extension.ExtensionGlobals.recyclingBinView, extension.ExtensionGlobals.outlineView, 0, null, "Insert");
		if (moveResult.moveOffset === -1) return;
		const effectedContainers = moveResult.effectedContainers;
		const outline =  extension.ExtensionGlobals.outlineView;
		return outline.refresh(false, effectedContainers);
	}

	async copyNode () {
		const result = await this.selectFiles();
		if (result === null) {
			return;
		}
		const nodes = result as readonly OutlineNode[];
		return extension.ExtensionGlobals.outlineView.copy(nodes);
	};
	
	async pasteNode () {
		const result = await this.selectFiles();
		if (result === null) {
			return null;
		}
		const destinations = result;
		return copyPaste.genericPaste(destinations);
	};
	
	async duplicateNode () {
		const result = await this.selectFiles();
		if (result === null) {
			return null;
		}
		const destinations = result;
		const outlineView = extension.ExtensionGlobals.outlineView;
		for (const dest of destinations) {
			await outlineView.copy([dest] as readonly OutlineNode[]);
	
			const parentUri = dest.getParentUri();
			const parentNode = await outlineView.getTreeElementByUri(parentUri);
			if (parentNode !== null) {
				await copyPaste.genericPaste([parentNode]);
			}
		}
	};
}