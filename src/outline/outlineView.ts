/* eslint-disable curly */


import * as extension from '../extension';
import * as vscode from 'vscode';
import { InitializeNode, initializeOutline } from "../outlineProvider/initialize";
import { OutlineNode, ContainerNode, RootNode } from "./nodes_impl/outlineNode";
import { OutlineTreeProvider } from "../outlineProvider/outlineTreeProvider";
import * as reorderFunctions from './impl/reorderNodes';
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
import { RecyclingBinView } from '../recyclingBin/recyclingBinView';

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
		vscode.window.onDidChangeActiveTextEditor((editor) => this.selectActiveDocument(editor));
		this.selectActiveDocument(vscode.window.activeTextEditor);
	}
	
	dropMimeTypes = ['application/vnd.code.tree.outline', 'application/vnd.code.tree.recycling', 'text/uri-list'];
	dragMimeTypes = ['text/uri-list'];

	public async handleDrop(target: OutlineNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		const targ = target || this.rootNodes[0];
		if (!targ) throw 'unreachable';

		let overrideDestination: OutlineNode | null = null;

		const effectedContainersUriMap: {
			[index: string]: OutlineNode,
		} = {};

		const recyclingView: RecyclingBinView = await vscode.commands.executeCommand('wt.recyclingBin.getRecyclingBinView');

		const moveOperations: { 
			dataTransferType: string, 
			operation: 'move' | 'recover',
			sourceProvider: UriBasedView<OutlineNode>
		}[] = [{
			dataTransferType: 'application/vnd.code.tree.outline',
			operation: 'move',
			sourceProvider: this,
		}, {
			dataTransferType: 'application/vnd.code.tree.recycling',
			operation: 'recover',
			sourceProvider: recyclingView
		}];

		for (const{ dataTransferType, operation, sourceProvider } of moveOperations) {
			const transferItems = dataTransfer.get(dataTransferType);
			if (!transferItems) continue;

			let movedOutlineItems: OutlineNode[];
			if (typeof transferItems.value === 'string') {
				// When the transfer item comes from another view, it seems that the tranfer item is stringified before landing here
				//		so when the recycling bin tranfers nodes to recover, they will come as JSON strings
				// To recover from this, JSON parse the transfered nodes, then search the recycling bin view for those items by their 
				//		uris
				const movedItemsJSON: OutlineNode[] = JSON.parse(transferItems.value as string);
				const movedRecyclingItemsRaw: OutlineNode[] = await Promise.all(
					movedItemsJSON.map(mij => {
						// Convert to a string then back to the Uri because I'm not sure if the parsed JSON will be correctly viewed
						//		as an instanceof vscode.Uri on all platforms
						const uri = vscode.Uri.file(mij.data.ids.uri.fsPath);
						return recyclingView.getTreeElementByUri(uri);
					})
				);

				// The 'Dummy' node that tells users to drag and drop onto it to delete is the only possible
				//		node with a fragment type and a root parent type
				// Obviously, we do not want to recover this node, so ignore it
				movedOutlineItems = movedRecyclingItemsRaw.filter(ri => {
					return !(ri.data.ids.type === 'fragment' && ri.data.ids.parentTypeId === 'root');
				});
			}
			else {
				movedOutlineItems = transferItems.value;
			}

			// Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
			const uniqueRoots = await this.getLocalRoots(movedOutlineItems);
			const filteredOutlineParents = uniqueRoots.filter(root => root.getParentUri().toString() !== targ.getUri().toString());

			// Move all the valid nodes into the target
			if (filteredOutlineParents.length <= 0) continue;

			// Offset tells how many nodes have moved downwards in the same container so far
			// In the case where multiple nodes are moving downwards at once, it lets
			//		.moveNode know how many nodes have already moved down, and 
			//		lets it adapt to those changes
			let offset = 0;
			for (const mover of filteredOutlineParents) {

				// Do the move on the target destination with the selected operation
				const res: MoveNodeResult = await mover.generalMoveNode(
					operation, targ,
					operation === 'move' ? this : recyclingView,				// the source is either the outline tree for 'move's or the recycling bin for 'recovers'
					this, offset, overrideDestination
				);
				const { moveOffset, createdDestination, effectedContainers } = res;
				if (moveOffset === -1) break;
				offset += moveOffset;

				// If there was a destination created by the latest move, then use that destination as the override destination for 
				//		all future moves in this function call
				// New destinations are created when dragging a fragment into a snip container (a new snip is created inside of the
				//		snip container and all future fragments will also be tranferred into that container)
				if (createdDestination) {
					overrideDestination = createdDestination;
				}

				for (const container of effectedContainers) {
					effectedContainersUriMap[container.getUri().fsPath] = container;
				}

				await new Promise(resolve => setTimeout(resolve, 10));
			}

			// Refresh the entire recycling view every time we recover, because the recycling should be rather 
			//		small most of the time
			if (operation === 'recover') {
				await recyclingView.refresh(false, []);
			}
		}

		const allEffectedContainers = Object.entries(effectedContainersUriMap)
			.map(([ _, container ]) => container);
		this.refresh(false, allEffectedContainers);
		
	}
	
	public async handleDrag(source: OutlineNode[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		treeDataTransfer.set('application/vnd.code.tree.outline', new vscode.DataTransferItem(source));

		const uris: vscode.Uri[] = source.map(src => src.getDroppableUris()).flat();
		const uriStrings = uris.map(uri => uri.toString());
		
		// Combine all collected uris into a single string
		const sourceUriList = uriStrings.join('\r\n');
		treeDataTransfer.set('text/uri-list', new vscode.DataTransferItem(sourceUriList));
	}
}