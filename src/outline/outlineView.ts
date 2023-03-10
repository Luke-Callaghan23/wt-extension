/* eslint-disable curly */


import * as extension from '../extension';
import * as vscode from 'vscode';
import { InitializeNode, initializeOutline } from "../outlineProvider/initialize";
import { OutlineNode, ContainerNode, RootNode } from "./outlineNodes";
import { OutlineTreeProvider } from "../outlineProvider/outlineTreeProvider";
import * as reorderFunctions from './reorderNodes';
import * as removeFunctions from './removeNodes';
import * as createFunctions from './createNodes';
import * as renameFunctions from './renameNodes';
import { Workspace } from '../workspace/workspace';
import { NodeTypes } from '../outlineProvider/fsNodes';
import * as console from '../vsconsole';

export class OutlineView extends OutlineTreeProvider<OutlineNode> {

    async initializeTree(): Promise<OutlineNode> {
		const init: InitializeNode<OutlineNode> = (data: NodeTypes<OutlineNode>) => new OutlineNode(data);
        return initializeOutline(init);
    }

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

    // Register all the commands needed for the outline view to work
    registerCommands () {
        vscode.commands.registerCommand('wt.outline.openFile', (resource) => {
			vscode.window.showTextDocument(resource, { preserveFocus: true });
		});
		vscode.commands.registerCommand('wt.outline.refresh', (resource: OutlineNode) => super.refresh());
		vscode.commands.registerCommand('wt.outline.renameFile', () => {
			if (this.view.selection.length > 1) return;
			this.renameResource();
		});

		vscode.commands.registerCommand("wt.outline.newChapter", (resource) => {
			this.newChapter(resource);
		});
		vscode.commands.registerCommand("wt.outline.newSnip", (resource) => {
			this.newSnip(resource);
		});
		vscode.commands.registerCommand("wt.outline.newFragment", (resource) => {
			this.newFragment(resource);
		});

		
		vscode.commands.registerCommand("wt.outline.moveUp", (resource) => this.moveUp(resource));
		vscode.commands.registerCommand("wt.outline.moveDown", (resource) => this.moveDown(resource));
		
		vscode.commands.registerCommand("wt.outline.removeResource", (resource) => this.removeResource(resource));

		vscode.commands.registerCommand("wt.outline.collectChapterUris", () => {
			const root: RootNode = this.tree.data as RootNode;
			const chaptersContainer: ContainerNode = root.chapters.data as ContainerNode;
			return chaptersContainer.contents.map(c => {
				const title = c.data.ids.display;
				const uri = c.getUri().fsPath.split(extension.rootPath.fsPath)[1];
				return [uri, title];
			});
		});

		vscode.commands.registerCommand('wt.outline.help', () => {
			vscode.window.showInformationMessage(`Outline View`, {
                modal: true,
				detail: `The outline view gives a general outline of the structure of your project.  It shows all the chapters, chapter fragments, chapter snips, chapter snip fragments, work snips, and work snip fragments of your entire work.  For more information hit 'Ctrl+Shift+P' and type 'wt:help' into the search bar for more information.`
            }, 'Okay');
		});

		vscode.commands.registerCommand('wt.outline.getOutline', () => this);
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

    constructor(
        context: vscode.ExtensionContext, 
		protected workspace: Workspace
    ) {
        super(context, 'wt.outline');
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	}


	async init (): Promise<void> {
		await this._init();
		this.registerCommands();
	}
}