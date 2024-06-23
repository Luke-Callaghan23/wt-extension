/* eslint-disable curly */
import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as extension from '../extension';
import { InitializeNode, initializeChapter, initializeFragment, initializeOutline, initializeSnip } from '../outlineProvider/initialize';
// import { OutlineNode, ResourceType } from '../outline/node';
import { NodeTypes, ResourceType } from '../outlineProvider/fsNodes';
import { ConfigFileInfo, determineAuxViewColumn } from '../help';
import { v4 as uuidv4 } from 'uuid';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { deleteNodePermanently } from './deleteNodePermanently';
import { OutlineNode, SnipNode } from '../outline/nodes_impl/outlineNode';
import { OutlineView } from '../outline/outlineView';
import { TreeNode } from '../outlineProvider/outlineTreeProvider';
import { Buff } from '../Buffer/bufferSource';
import { newScratchPadFile } from './createScratchPadFile';
import { Renamable } from '../recyclingBin/recyclingBinView';

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
    }

    static scratchPadContainerUri: vscode.Uri;
    static scratchPadConfigUri: vscode.Uri;

    public view: vscode.TreeView<OutlineNode>;
    constructor(
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
        super();
        this.view = {} as vscode.TreeView<OutlineNode>;
        ScratchPadView.scratchPadContainerUri = vscode.Uri.joinPath(extension.rootPath, 'data', 'scratchPad');
        ScratchPadView.scratchPadConfigUri = vscode.Uri.joinPath(ScratchPadView.scratchPadContainerUri, '.config')
    }

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
        
        this.view = vscode.window.createTreeView('wt.scratchPad', { 
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
        const targ = target || this.rootNodes[0];
        if (!targ) throw 'unreachable';
        
        const outlineTransferItem = dataTransfer.get('application/vnd.code.tree.outline');
        if (!outlineTransferItem) return;
        
        const outlineView: OutlineView = extension.ExtensionGlobals.outlineView;
        const movedItemsJSON: OutlineNode[] = JSON.parse(outlineTransferItem.value);
        const movedItems: OutlineNode[] = await Promise.all(
            movedItemsJSON.map(mij => {
                const uri = vscode.Uri.file(mij.data.ids.uri.fsPath);
                return outlineView.getTreeElementByUri(uri) as Promise<OutlineNode>;
            })
        );

        // Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
        const uniqueRoots = await outlineView.getLocalRoots(movedItems);
        const filteredParents = uniqueRoots.filter(root => root.getParentUri().toString() !== targ.getUri().toString());
        await outlineView.removeResource(filteredParents);
    }

    async handleDrag (source: readonly OutlineNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        dataTransfer.set('application/vnd.code.tree.scratch', new vscode.DataTransferItem(source));
        
        const uris: vscode.Uri[] = source.map(src => src.getDroppableUris()).flat();
        const uriStrings = uris.map(uri => uri.toString());
        
        // Combine all collected uris into a single string
        const sourceUriList = uriStrings.join('\r\n');
        dataTransfer.set('text/uri-list', new vscode.DataTransferItem(sourceUriList));
    }

    async getParent (element: OutlineNode): Promise<OutlineNode> {
        //@ts-ignore
        return null;
    }
}