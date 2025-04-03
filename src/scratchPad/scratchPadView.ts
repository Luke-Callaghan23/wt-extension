/* eslint-disable curly */
import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as extension from '../extension';
import { initializeSnip } from '../outlineProvider/initialize';
// import { OutlineNode, ResourceType } from '../outline/node';
import { NodeTypes, ResourceType } from '../outlineProvider/fsNodes';
import { ConfigFileInfo, determineAuxViewColumn } from '../miscTools/help';
import { v4 as uuidv4 } from 'uuid';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { deleteNodePermanently } from './deleteNodePermanently';
import { OutlineNode, SnipNode } from '../outline/nodes_impl/outlineNode';
import { OutlineView } from '../outline/outlineView';
import { TreeNode } from '../outlineProvider/outlineTreeProvider';
import { Buff } from '../Buffer/bufferSource';
import { newScratchPadFile } from './createScratchPadFile';
import { Renamable } from '../recyclingBin/recyclingBinView';
import * as search from '../miscTools/searchFiles';
import { handleDragController } from '../outline/impl/dragDropController';

export type RecycleLog = {
    oldUri: string,
    recycleBinName: string,
    deleteTimestamp: number,
    resourceType: ResourceType,
    title: string,
};


export class ScratchPadView 
extends UriBasedView<OutlineNode>
implements 
    vscode.TreeDataProvider<OutlineNode>, 
    vscode.TreeDragAndDropController<OutlineNode>,
    Renamable<OutlineNode>
{

    // tree data provider
    //#region

    deleteNodePermanently = deleteNodePermanently;
    newScratchPadFile = newScratchPadFile;

    async renameResource (overrideNode?: OutlineNode, overrideRename?: string) {
        const outlineView: OutlineView = extension.ExtensionGlobals.outlineView;
        if (!outlineView) return;
        await outlineView.renameResource(overrideNode || this.view.selection[0]);
        this.refresh(true, []);
    }

    rootNodes: OutlineNode[] = [];
    async initializeTree(): Promise<OutlineNode[] | null> {
        const on = new OutlineNode(await initializeSnip({
            parentDotConfig: {},
            init: (data: NodeTypes<OutlineNode>) => new OutlineNode(data),
            parentTypeId: 'container',
            parentUri: ScratchPadView.scratchPadContainerUri,
            relativePath: '',
            fileName: '',
            dontFail: true,
        }));

        return (on.data as SnipNode).contents;
    }

    async getChildren (element?: OutlineNode): Promise<OutlineNode[]> {
        if (element) return [];
        return [...this.rootNodes];
    }

    async getTreeItem (element: OutlineNode): Promise<vscode.TreeItem> {
        return {
            id: uuidv4(),
            label: /**vscode.TreeItemLabel**/<any>{ 
                label: element.getDisplayString()
            },
            // An example of how to use codicons in a MarkdownString in a tree item tooltip.
            tooltip: element.getTooltip(),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            resourceUri: element.getUri(),
            command: { 
                command: 'wt.scratchPad.openFile', 
                title: "Open File", 
                arguments: [element.getUri()], 
            },
            contextValue: 'file',
            iconPath: new vscode.ThemeIcon('edit')
        };
    }
    //#endregion

    // Refresh the tree data information

    private _onDidChangeTreeData: vscode.EventEmitter<OutlineNode | undefined> = new vscode.EventEmitter<OutlineNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<OutlineNode | undefined> = this._onDidChangeTreeData.event;
    
    async refresh (_reload: boolean, _updates: OutlineNode[]): Promise<void> {
        const result = await this.initializeTree();
        if (result === null) return;
        this.rootNodes = result;
        this._onDidChangeTreeData.fire(undefined);
    }
    //#endregion

    registerCommands() {
        vscode.commands.registerCommand("wt.scratchPad.permanentlyDelete", (resource) => {
            let targets: OutlineNode[];
            if (resource) {
                targets = [resource];
            }
            else {
                targets = [...this.view.selection];
            }
            this.deleteNodePermanently(targets);
        });
        vscode.commands.registerCommand("wt.scratchPad.refresh", () => this.refresh(true, []));
        vscode.commands.registerCommand('wt.scratchPad.getScratchPad', () => this);
        vscode.commands.registerCommand('wt.scratchPad.deleteAll', () => {
            return this.deleteNodePermanently(this.rootNodes);
        });
        vscode.commands.registerCommand('wt.scratchPad.renameFile', async () => {
            if (this.view.selection.length > 1) return;
            this.renameResource(this.view.selection[0]);
        });

        vscode.commands.registerCommand('wt.scratchPad.newFile', () => {
            return this.newScratchPadFile();
        });

        vscode.commands.registerCommand('wt.scratchPad.openFile', async (resource: vscode.Uri) => {
            vscode.window.showTextDocument(resource, { 
                preserveFocus: true,
                viewColumn: await determineAuxViewColumn((uri) => this.getTreeElementByUri(uri)),
            });
        });

        vscode.commands.registerCommand('wt.scratchPad.manualMove', (resource: OutlineNode) => this.manualMove(resource));

        vscode.commands.registerCommand("wt.scratchPad.commandPalette.deleteNode", async () => {
            const deletes = await this.selectFiles();
            if (deletes === null) {
                return null;
            }
            return this.deleteNodePermanently(deletes);
        });

        vscode.commands.registerCommand("wt.scratchPad.commandPalette.renameNode", async () => {
            const renamer = await this.selectFile();
            if (renamer === null) {
                return null;
            }
            return this.renameResource(renamer);
        });

        vscode.commands.registerCommand("wt.scratchPad.commandPalette.moveNode", async () => {
            const mover = await this.selectFile();
            if (mover === null) {
                return null;
            }
            return this.manualMove(mover);
        });
    }

    static scratchPadContainerUri: vscode.Uri;
    static scratchPadConfigUri: vscode.Uri;

    public view: vscode.TreeView<OutlineNode>;
    constructor(
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
        super("Scratch Pad");
        this.view = {} as vscode.TreeView<OutlineNode>;
        ScratchPadView.scratchPadContainerUri = vscode.Uri.joinPath(extension.rootPath, 'data', 'scratchPad');
        ScratchPadView.scratchPadConfigUri = vscode.Uri.joinPath(ScratchPadView.scratchPadContainerUri, '.config')
    }

    static readonly viewId: string = 'wt.scratchPad';
    async init () {
        // Since older versions of WTANIWe did not have scratch pad, we can't take it as a given that the scratchPad folder
        //      exists in the workspace
        try {
            await vscode.workspace.fs.stat(ScratchPadView.scratchPadContainerUri);
        }
        catch (err: any) {
            // If the stat fails, then make the container directory and an empty config file
            await vscode.workspace.fs.createDirectory(ScratchPadView.scratchPadContainerUri);
            await vscode.workspace.fs.writeFile(ScratchPadView.scratchPadConfigUri, Buff.from("{}"));
        }

        const rootNodes = await this.initializeTree();
        if (rootNodes === null) return;
        this.rootNodes = rootNodes;
        
        this.view = vscode.window.createTreeView(ScratchPadView.viewId, { 
            treeDataProvider: this,
            showCollapseAll: true, 
            canSelectMany: true,
            dragAndDropController: this,
        });
        this.registerCommands();
    }


    dropMimeTypes = ['application/vnd.code.tree.outline', 'text/uri-list'];
    dragMimeTypes = ['text/uri-list'];

    async handleDrop (target: OutlineNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        throw "Drag and drop not available for scratch pad view";
    }

    dragController = handleDragController;
    async handleDrag (source: OutlineNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        return this.dragController('application/vnd.code.tree.scratch', source, dataTransfer, token);
    }

    async getParent (element: OutlineNode): Promise<OutlineNode> {
        //@ts-ignore
        return null;
    }

    async manualMove (resource: OutlineNode) {
        const outline =  extension.ExtensionGlobals.outlineView;
        const chose = await outline.selectFile([ (node) => {
            return node.data.ids.type !== 'fragment'
        } ]);
        if (chose === null) return;
        if (chose.data.ids.type === 'root') return;
        
        const moveResult = await resource.generalMoveNode("scratch", chose, extension.ExtensionGlobals.recyclingBinView, extension.ExtensionGlobals.outlineView, 0, null, "Insert");
        if (moveResult.moveOffset === -1) return;
        const effectedContainers = moveResult.effectedContainers;
        return Promise.all([
            outline.refresh(false, effectedContainers),
            this.refresh(true, []),
        ]);
    }
}