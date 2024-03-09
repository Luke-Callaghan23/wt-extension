/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri'
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../vsconsole';
import * as extension from './../extension';
import { OutlineView } from '../outline/outlineView';
import { InitializeNode, initializeChapter, initializeFragment, initializeOutline, initializeSnip } from '../outlineProvider/initialize';
import { OutlineNode, ResourceType } from '../outline/node';
import { NodeTypes } from '../outlineProvider/fsNodes';
import { RecyclingBinNode } from './node/recyclingBinNode';
import { ConfigFileInfo } from '../help';
import { v4 as uuidv4 } from 'uuid';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { removeResource } from './node/removeNode';
import { renameResource } from './node/renameNode';

export type RecycleLog = {
    oldUri: string,
    recycleBinName: string,
    deleteTimestamp: number,
    resourceType: ResourceType,
    title: string,
};


export class RecyclingBinView 
extends UriBasedView<RecyclingBinNode>
implements vscode.TreeDataProvider<RecyclingBinNode> {

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


    removeResource = removeResource;
    renameResource = renameResource;



    rootNodes: RecyclingBinNode[] = [];
	async initializeTree(): Promise<RecyclingBinNode[] | null> {
		const init: InitializeNode<RecyclingBinNode> = (data: NodeTypes<RecyclingBinNode>) => new RecyclingBinNode(data);

        const log = await RecyclingBinView.readRecycleLog();
        if (!log) return null;
        const nodes: RecyclingBinNode[] = [];

        // Order trash items by their delete date descending
        const orderedLog = log.reverse();
        orderedLog.sort((a, b) => b.deleteTimestamp - a.deleteTimestamp);
        
        for (let nodeIdx = 0; nodeIdx < orderedLog.length; nodeIdx++) {
            const logItem = orderedLog[nodeIdx];
            let node: RecyclingBinNode;

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
                    node = new RecyclingBinNode(await initializeChapter({
                        parentDotConfig: dotConfig,
                        chaptersContainerUri: RecyclingBinView.recyclingUri,
                        fileName: logItem.recycleBinName,
                        init: init,
                        relativePath: '',
                        dontFail: true,
                    }));
                }
                else if (logItem.resourceType === 'snip') {
                    node = new RecyclingBinNode(await initializeSnip({
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
                    node = new RecyclingBinNode(await initializeFragment({
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

	async getChildren (element?: RecyclingBinNode): Promise<RecyclingBinNode[]> {
        // Root for the tree view is the root-level RecyclingBin nodes created in the `initialize` function
        if (!element) {
            return this.rootNodes;
        }
		return element.getChildren(true);
	}

	async getTreeItem (element: RecyclingBinNode): Promise<vscode.TreeItem> {
        const label = element.getDisplayString();

		let collapseState: vscode.TreeItemCollapsibleState;
		if (element.hasChildren()) {
			// If the tree element has children, look that element up in the uri map to find the collapsability
			const uri = element.getUri();
			const usableUri = uri.fsPath.replace(extension.rootPath.fsPath, '');
			const isCollapsed: boolean | undefined = this.uriToVisibility[usableUri];
			if (isCollapsed === undefined || isCollapsed === false) {
				collapseState = vscode.TreeItemCollapsibleState.Collapsed;
			}
			else {
				collapseState = vscode.TreeItemCollapsibleState.Expanded;
			}
            collapseState = vscode.TreeItemCollapsibleState.Expanded;
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
	private _onDidChangeTreeData: vscode.EventEmitter<RecyclingBinNode | undefined> = new vscode.EventEmitter<RecyclingBinNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<RecyclingBinNode | undefined> = this._onDidChangeTreeData.event;
	
	async refresh(reload: boolean, updates: OutlineNode[]): Promise<void> {

		// If the reload option is set to true, the caller wants us to reload the outline tree
		//		completely from disk
		if (reload) {
			const result = await this.initializeTree();
            if (result === null) return;
            this.rootNodes = result;
		}

		// Because of all the various edits that the outline view does on the internal structure 
		//		and because we want to avoid uneeded reading of the disk file structure, we
		//		send over the outline node to the todo view whenever their is updates
		//		to the outline view tree
		vscode.commands.executeCommand('wt.todo.updateTree', this.rootNodes);

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
        vscode.commands.registerCommand("wt.recyclingBin.permanentlyDelete", (resource) => this.removeResource(resource));
        vscode.commands.registerCommand('wt.recyclingBin.renameFile', () => {
            if (this.view.selection.length > 1) return;
            this.renameResource();
        });    
	}

    protected view: vscode.TreeView<RecyclingBinNode>;
	constructor(
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
        super();
        this.view = {} as vscode.TreeView<RecyclingBinNode>;
        RecyclingBinView.recyclingUri = vscode.Uri.joinPath(extension.rootPath, `data/recycling`);
        (async () => {
            const rootNodes = await this.initializeTree();
            if (rootNodes === null) return;
            this.rootNodes = rootNodes;
            
            const view = vscode.window.createTreeView('wt.recyclingBin', { 
                treeDataProvider: this,
                showCollapseAll: true, 
                canSelectMany: true,
            });
            context.subscriptions.push();
            this.registerCommands();

            this.view = view;
            this.initUriExpansion('wt.recyclingBin', this.view, this.context);
        })()
	}
}