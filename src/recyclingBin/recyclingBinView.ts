/* eslint-disable curly */
import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as extension from './../extension';
import { InitializeNode, initializeChapter, initializeFragment, initializeSnip } from '../outlineProvider/initialize';
// import { OutlineNode, ResourceType } from '../outline/node';
import { NodeTypes, ResourceType } from '../outlineProvider/fsNodes';
import { ConfigFileInfo, progressOnViews, setFsPathKey } from '../miscTools/help';
import { v4 as uuidv4 } from 'uuid';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { deleteNodePermanently } from './node/deleteNodePermanently';
import { renameResource as _renameResource } from './node/renameNode';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { OutlineView } from '../outline/outlineView';
import { handleDragController } from '../outline/impl/dragDropController';

export type RecycleLog = {
    oldUri: string,
    recycleBinName: string,
    deleteTimestamp: number,
    resourceType: ResourceType,
    title: string,
};

export interface Renamable<T> {
    renameResource(node?: T): Promise<void>
}

export class RecyclingBinView 
extends UriBasedView<OutlineNode>
implements 
    vscode.TreeDataProvider<OutlineNode>, vscode.TreeDragAndDropController<OutlineNode>, Renamable<OutlineNode> {

    // tree data provider
    //#region

    static recyclingUri: vscode.Uri;
    static async readRecycleLog (): Promise<RecycleLog[] | null> {
        const recyclingLogUri = vscode.Uri.joinPath(RecyclingBinView.recyclingUri, '.log');
        try {
            const recyclingData = await vscode.workspace.fs.readFile(recyclingLogUri);
            const recyclingJSON = extension.decoder.decode(recyclingData);
            return JSON.parse(recyclingJSON);
        }
        catch (err: any) {
            vscode.window.showErrorMessage(`An error occurred while reading recyling log data: ${err.message}`);
            return null;
        }
    }

    static async writeRecycleLog (log: RecycleLog[]): Promise<void> {
        const recyclingLogUri = vscode.Uri.joinPath(RecyclingBinView.recyclingUri, '.log');
        try {
            const recyclingJSON = JSON.stringify(log);
            const recyclingData = extension.encoder.encode(recyclingJSON);
            vscode.workspace.fs.writeFile(recyclingLogUri, recyclingData);
        }
        catch (err: any) {
            vscode.window.showErrorMessage(`An error occurred while reading recyling log data: ${err.message}`);
        }
    }


    deleteNodePermanently = deleteNodePermanently;
    renameResource = _renameResource;

    rootNodes: OutlineNode[] = [];
    async initializeTree(): Promise<OutlineNode[] | null> {
        const init: InitializeNode<OutlineNode> = (data: NodeTypes<OutlineNode>) => new OutlineNode(data);

        const log = await RecyclingBinView.readRecycleLog();
        if (!log) return null;
        const nodes: OutlineNode[] = [];

        // Order trash items by their delete date descending
        const orderedLog = log.reverse();
        orderedLog.sort((a, b) => b.deleteTimestamp - a.deleteTimestamp);
        
        for (let nodeIdx = 0; nodeIdx < orderedLog.length; nodeIdx++) {
            const logItem = orderedLog[nodeIdx];
            let node: OutlineNode;

            const dotConfig: { [index: string]: ConfigFileInfo } = {
                [logItem.recycleBinName]: {
                    ordering: nodeIdx,
                    title: logItem.title
                }
            };

            // Create nodes for each of the root-level deleted items listed in the recycling log using
            //      the same initialization function that the TODO tree and outline tree both use
            try {
                if (logItem.resourceType === 'chapter') {
                    node = new OutlineNode(await initializeChapter({
                        parentDotConfig: dotConfig,
                        chaptersContainerUri: RecyclingBinView.recyclingUri,
                        fileName: logItem.recycleBinName,
                        init: init,
                        relativePath: '',
                        dontFail: true,
                    }));
                }
                else if (logItem.resourceType === 'snip') {
                    node = new OutlineNode(await initializeSnip({
                        parentDotConfig: dotConfig,
                        init: init,
                        parentTypeId: 'container',
                        parentUri: RecyclingBinView.recyclingUri,
                        relativePath: '',
                        fileName: logItem.recycleBinName,
                        dontFail: true,
                    }));
                }
                else if (logItem.resourceType === 'fragment') {
                    node = new OutlineNode(await initializeFragment({
                        parentDotConfig: dotConfig,
                        fileName: logItem.recycleBinName,
                        parentTypeId: 'container',
                        parentUri: RecyclingBinView.recyclingUri,
                        relativePath: '',
                    }));
                }
                else throw `unreachable`;
                nodes.push(node);
            }
            catch (err: any) {}
        }
        return nodes;
    }

    async getChildren (element?: OutlineNode): Promise<OutlineNode[]> {
        // Root for the tree view is the root-level RecyclingBin nodes created in the `initialize` function
        if (!element) {
            return [new OutlineNode({
                ids: {
                    display: 'Drag and Drop Outline Items Here',
                    fileName: '',
                    ordering: -1,
                    parentTypeId: 'root',
                    parentUri: RecyclingBinView.recyclingUri,
                    relativePath: '',
                    type: 'fragment',
                    uri: RecyclingBinView.recyclingUri
                },
                md: ''
            }), ...this.rootNodes];
        }
        
        const insertIntoNodeMap = (node: OutlineNode, uri: vscode.Uri) => {
            setFsPathKey<OutlineNode>(uri, node as OutlineNode, this.nodeMap);
        }
        //@ts-ignore
        return element.getChildren(true, insertIntoNodeMap);
    }

    async getTreeItem (element: OutlineNode): Promise<vscode.TreeItem> {
        const label = element.getDisplayString();

		let collapseState: vscode.TreeItemCollapsibleState;
		if (element.hasChildren()) {
			// If the tree element has children, look that element up in the uri map to find the collapsability
			const uri = element.getUri();
			const usableUri = uri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');;
			const isCollapsed: boolean | undefined = this.uriToVisibility[usableUri];
			if (isCollapsed === undefined || isCollapsed === false) {
				collapseState = vscode.TreeItemCollapsibleState.Collapsed;
			}
			else {
				collapseState = vscode.TreeItemCollapsibleState.Expanded;
			}
            // collapseState = vscode.TreeItemCollapsibleState.Expanded;
        }
        else {
            // If the element has no children, then don't give it any collapse-ability
            collapseState = vscode.TreeItemCollapsibleState.None;
        }

        const treeItem: vscode.TreeItem = {
            id: uuidv4(),
            label: /**vscode.TreeItemLabel**/<any>{ 
                label: label
            },
            // An example of how to use codicons in a MarkdownString in a tree item tooltip.
            tooltip: element.getTooltip(),
            collapsibleState: collapseState,
            resourceUri: element.getUri(),
        };

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
        let icon = element.data.ids.type === 'fragment'
            ? 'edit'
            : 'symbol-folder';

        if (element.data.ids.relativePath === '') {
            icon = 'trash';
        }

        treeItem.iconPath = new vscode.ThemeIcon(icon);
        return treeItem;
    }
    //#endregion

    // Refresh the tree data information

    private allDocs: vscode.Uri[] = [];
    private _onDidChangeTreeData: vscode.EventEmitter<OutlineNode | undefined> = new vscode.EventEmitter<OutlineNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<OutlineNode | undefined> = this._onDidChangeTreeData.event;
    
    async refresh(reload: boolean, updates: OutlineNode[]): Promise<void> {
        // If the reload option is set to true, the caller wants us to reload the outline tree
        //        completely from disk
        if (reload) {
            const result = await this.initializeTree();
            if (result === null) return;
            this.rootNodes = result;
        }

        // Then update the root node of the outline view
        if (updates.length > 0) {
            for (const update of updates) {
                this._onDidChangeTreeData.fire(update);
            }
        }
        else {
            this._onDidChangeTreeData.fire(undefined);
        }
    }
    //#endregion

    registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.recyclingBin.permanentlyDelete", (resource) => {
            let targets: OutlineNode[];
            if (resource) {
                targets = [resource];
            }
            else {
                targets = [...this.view.selection];
            }
            this.deleteNodePermanently(targets);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.recyclingBin.renameFile', () => {
            if (this.view.selection.length > 1) return;
            this.renameResource();
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.recyclingBin.refresh", () => this.refresh(true, [])));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.recyclingBin.getRecyclingBinView', () => this));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.recyclingBin.deleteAll', () => {
            this.deleteNodePermanently(this.rootNodes);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.recyclingBin.recoverNode', (resource: OutlineNode) => this.recoverNode(resource)));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.recyclingBin.commandPalette.deleteNode", async () => {
            const deletes = await this.selectFiles();
            if (deletes === null) {
                return null;
            }
            return this.deleteNodePermanently(deletes);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.recyclingBin.commandPalette.renameNode", async () => {
            const renamer = await this.selectFile();
            if (renamer === null) {
                return null;
            }
            return this.renameResource(renamer);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.recyclingBin.commandPalette.recoverNode", async () => {
            const mover = await this.selectFile();
            if (mover === null) {
                return null;
            }
            return this.recoverNode(mover);
        }));
    }

    public view: vscode.TreeView<OutlineNode>;
    constructor(
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
        super("Recycling Bin");
        this.view = {} as vscode.TreeView<OutlineNode>;
        RecyclingBinView.recyclingUri = vscode.Uri.joinPath(extension.rootPath, `data/recycling`);
    }

    static readonly viewId: string = 'wt.recyclingBin';
    async initialize () {
        const rootNodes = await this.initializeTree();
        if (rootNodes === null) return;
        this.rootNodes = rootNodes;
        
        const view = vscode.window.createTreeView(RecyclingBinView.viewId, { 
            treeDataProvider: this,
            showCollapseAll: true, 
            canSelectMany: true,
            dragAndDropController: this,
        });
        this.context.subscriptions.push(view);
        this.registerCommands();

        this.view = view;
        await this.initUriExpansion(RecyclingBinView.viewId, this.view, this.context);
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

    dragController = handleDragController;
    async handleDrag (source: OutlineNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        return this.dragController('application/vnd.code.tree.recycling', source, dataTransfer, token);
    }

    async getParent (element: OutlineNode): Promise<OutlineNode> {
        if (element.data.ids.relativePath === '') {
            return element;
        }
        const parentUri = element.getParentUri();
        const parent = await this.getTreeElementByUri(parentUri);
        if (!parent) return this.rootNodes[0];
        return parent;
    }

    async recoverNode (resource: OutlineNode) {
        const outline =  extension.ExtensionGlobals.outlineView;
        const chose = await outline.selectFile([ (node) => {
            return node.data.ids.type !== 'fragment'
        } ]);
        if (chose === null) return;
        if (chose.data.ids.type === 'root') return;
        
        const moveResult = await resource.generalMoveNode("recover", chose, extension.ExtensionGlobals.recyclingBinView, extension.ExtensionGlobals.outlineView, 0, null, "Insert");
        if (moveResult.moveOffset === -1) return;
        const effectedContainers = moveResult.effectedContainers;
        return Promise.all([
            outline.refresh(false, effectedContainers),
            this.refresh(true, []),
        ]);
    }
}