import * as vscode from 'vscode';
import { HasGetUri, UriBasedView } from '../outlineProvider/UriBasedView';
import { createFileSystemTree } from './processGrepResults/createFileSystemTree';
import { Workspace } from '../workspace/workspaceClass';
import * as extension from '../extension';
import { randomUUID } from 'crypto';
import { executeGitGrep } from '../miscTools/executeGitGrep';
import { FileResultLocationNode, FileResultNode, MatchedTitleNode, SearchContainerNode, SearchNode, SearchNodeTemporaryText } from './searchResultsNode';
import { cleanNodeTree, pairMatchedTitlesToNeighborNodes, recreateNodeTree } from './processGrepResults/createNodeTree';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';


export type SearchNodeKind = SearchContainerNode | FileResultNode | FileResultLocationNode | SearchNodeTemporaryText | MatchedTitleNode;

export class SearchResultsView extends UriBasedView<SearchNode<SearchNodeKind>>
    implements vscode.TreeDataProvider<SearchNode<SearchNodeKind>> {

    constructor (
        protected workspace: Workspace,
        protected context: vscode.ExtensionContext
    ) {
        super();
        this.rootNodes = [];
    }

    
    private _onDidChangeTreeData: vscode.EventEmitter<SearchNode<SearchNodeKind> | undefined> = new vscode.EventEmitter<SearchNode<SearchNodeKind> | undefined>();
    readonly onDidChangeTreeData: vscode.Event<SearchNode<SearchNodeKind> | undefined> = this._onDidChangeTreeData.event;
    
    async initialize() {
        const viewName = 'wt.wtSearch.results';
        const view = vscode.window.createTreeView(viewName, { 
            treeDataProvider: this,
            showCollapseAll: true, 
            canSelectMany: true,
        });
        this.context.subscriptions.push();
        this.registerCommands();
        this.view = view;

        await this.initUriExpansion(viewName, this.view, this.context);
    }

    async refresh(): Promise<void> {
        this._onDidChangeTreeData.fire(undefined);
    }

    registerCommands() {
        vscode.commands.registerCommand('wt.wtSearch.results.search', async () => {
            const response = await vscode.window.showInputBox({
                ignoreFocusOut: false,
                password: false,
                placeHolder: 'Search . . . ',
                prompt: 'Search Term',
                title: 'Search Term',
            });
            if (!response) return;
            const reg = new RegExp(response, 'gi');
            return this.searchBarValueWasUpdated(reg, true);
        });

        vscode.commands.registerCommand('wt.wtSearch.results.openResult', async (location: vscode.Location) => {
            // Called when a file location node is clicked in the results tree, opens the location in the editor
            const doc = await vscode.workspace.openTextDocument(location.uri);
            const editor = await vscode.window.showTextDocument(doc);
            editor.selections = [ new vscode.Selection(location.range.start, location.range.end) ];
            return editor.revealRange(location.range);
        });

        vscode.commands.registerCommand('wt.wtSearch.results.showNode', async (node: SearchNode<MatchedTitleNode>) => {
            // Called when a MatchedTitleNode is clicked in the outline tree,
            // When the matched title is the title of a fragment, opens that in the editor
            // Otherwise, reveals that node in the Outline / Scratch Pad / Recycling Bin / Notes view
            
            // Work bible or scratch pad or fragment: open in editor
            if (
                node.node.linkNode.source === 'workBible' || 
                node.node.linkNode.source === 'scratch' || 
                node.node.linkNode.node.data.ids.type === 'fragment'
            ) {
                const doc = await vscode.workspace.openTextDocument(node.getUri());
                return vscode.window.showTextDocument(doc);
            }

            // Outline or Recycling (when type is not fragment), then reveal the node 
            //      in its view
            let provider: UriBasedView<OutlineNode>;
            switch (node.node.linkNode.source) {
                case 'outline': provider = extension.ExtensionGlobals.outlineView; break;
                case 'recycle': provider = extension.ExtensionGlobals.recyclingBinView; break;
            }

            const treeViewNode = await provider.getTreeElementByUri(node.getUri());
            if (!treeViewNode) return;
            provider.view.reveal(treeViewNode);
        });
    }

    public async searchBarValueWasUpdated (searchRegex: RegExp, matchTitles: boolean, inLineSearch?: {
        regexWithIdGroup: RegExp,
        captureGroupId: string,
    }) {
        const exitWithNoResults = () => {
            this.rootNodes = [];
            this.refresh();
        }
        
        // Grep results
        const grepResults = await executeGitGrep(searchRegex, inLineSearch);
        if (!grepResults || grepResults.length === 0) return;
        
        // Create file system-esque tree from the grep results
        const fsTree = await createFileSystemTree(grepResults);

        // Create a node tree based off the file system tree
        const searchResults = await recreateNodeTree(fsTree, matchTitles);
        if (!searchResults) return exitWithNoResults();

        // Filter empty nodes and nodes with single results
        const filteredTree = cleanNodeTree(searchResults);

        // Pair up all MatchedTitleNodes with their paired SearchFileNode or SearchContainerNode, if one exists
        const finalPairedTree = pairMatchedTitlesToNeighborNodes(filteredTree);
        this.rootNodes = finalPairedTree;
        this.refresh();
    }

    public async searchCleared () {
        this.rootNodes = [];
        this.refresh();
    }
    
    getTreeItem (element: SearchNode<SearchNodeKind>): vscode.TreeItem | Thenable<vscode.TreeItem> {
        // File location nodes link to a location in a document, and have more complicated labels and tooltips
        if (element.node.kind === 'fileLocation') {
            return {
                id: randomUUID(),
                label: element.getLabel(),        
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                resourceUri: element.getUri(),
                tooltip: element.getTooltip(),
                description: element.description,
                command: {
                    command: 'wt.wtSearch.results.openResult',
                    title: 'Open Result',
                    arguments: [ element.node.location ]
                }
            }
        }
        else if (element.node.kind === 'matchedTitle') {
            let icon: vscode.ThemeIcon;
            if (element.node.linkNode.source === 'workBible' || element.node.linkNode.node.data.ids.type === 'fragment') {
                icon = new vscode.ThemeIcon('edit');
            }
            else {
                icon = new vscode.ThemeIcon('folder-opened');
            }
            return {
                id: randomUUID(),
                label: element.getLabel(),
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                resourceUri: element.getUri(),
                tooltip: element.getTooltip(),
                description: element.description,
                iconPath: icon,
                command: {
                    command: 'wt.wtSearch.results.showNode',
                    title: 'Show Node in Outline',
                    arguments: [ element ]
                }
            }
        }
        
        
        // 'searchTemp' type nodes will have a red (X) icon and no collapse state, where all other 
        //      nodes will have no icon and (by default) an open collapse state
        let icon: vscode.ThemeIcon | undefined;
        let collapseState: vscode.TreeItemCollapsibleState;
        if (element.node.kind === 'searchTemp') {
            collapseState = vscode.TreeItemCollapsibleState.Expanded;
            icon = new vscode.ThemeIcon('notebook-state-error', new vscode.ThemeColor('errorForeground'));
        }
        else {
            collapseState = vscode.TreeItemCollapsibleState.Expanded;
        }

        return {
            id: randomUUID(),
            label: element.getLabel(),
            resourceUri: element.getUri(),
            tooltip: element.getTooltip(),
            description: element.description && `(${element.description})`,
            iconPath: icon,
            collapsibleState: collapseState
        }
    }

    async getChildren (
        element?: SearchNode<SearchNodeKind> | undefined
    ): Promise<SearchNode<SearchNodeKind>[]> {
        if (!element) {
            // When there are no results in the node tree, then create a temporary node to indicate the empty results to the user
            if (this.rootNodes.length === 0) {
                return [ new SearchNode<SearchNodeTemporaryText>({
                    kind: 'searchTemp',
                    label: 'No results found.',
                    parentUri: null,
                    uri: extension.rootPath
                }) ];
            }
            return this.rootNodes;
        }
        return element.getChildren(false, ()=>{});
    }

    async getParent (element: SearchNode<SearchNodeKind>): Promise<SearchNode<SearchNodeKind> | null> {
        const parentUri = element.getParentUri();
        if (!parentUri) return null;
        return this.getTreeElementByUri(parentUri);
    }
}