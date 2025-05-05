import * as vscode from 'vscode';
import { HasGetUri, UriBasedView } from '../outlineProvider/UriBasedView';
import { createFileSystemTree } from './processGrepResults/createFileSystemTree';
import { Workspace } from '../workspace/workspaceClass';
import * as extension from '../extension';
import { v4 as uuid } from 'uuid';
import { grepExtensionDirectory } from '../miscTools/grepExtensionDirectory';
import { FileResultLocationNode, FileResultNode, MatchedTitleNode, SearchContainerNode, SearchNode, SearchNodeTemporaryText } from './searchResultsNode';
import { cleanNodeTree, pairMatchedTitlesToNeighborNodes, recreateNodeTree } from './processGrepResults/createNodeTree';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { compareFsPath, determineAuxViewColumn, showTextDocumentWithPreview, vagueNodeSearch } from '../miscTools/help';


export type SearchNodeKind = 
    SearchContainerNode
    | FileResultNode
    | FileResultLocationNode
    | SearchNodeTemporaryText
    | MatchedTitleNode;

export class SearchResultsView 
    extends UriBasedView<SearchNode<SearchNodeKind>>
    implements vscode.TreeDataProvider<SearchNode<SearchNodeKind>> 
{
    private static viewId = 'wt.wtSearch.results';
    private filteredUris: vscode.Uri[];
    constructor (
        protected workspace: Workspace,
        protected context: vscode.ExtensionContext
    ) {
        super("Search Results");
        this.rootNodes = [];
        this.filteredUris = [];
    }

    
    private _onDidChangeTreeData: vscode.EventEmitter<SearchNode<SearchNodeKind> | undefined> = new vscode.EventEmitter<SearchNode<SearchNodeKind> | undefined>();
    readonly onDidChangeTreeData: vscode.Event<SearchNode<SearchNodeKind> | undefined> = this._onDidChangeTreeData.event;
    
    async initialize() {
        const view = vscode.window.createTreeView(SearchResultsView.viewId, { 
            treeDataProvider: this,
            showCollapseAll: true, 
            canSelectMany: true,
        });
        this.context.subscriptions.push(view);
        this.registerCommands();
        this.view = view;

        await this.initUriExpansion(SearchResultsView.viewId, this.view, this.context);
    }

    async refresh(updatedNodes?: typeof this.rootNodes): Promise<void> {
        if (updatedNodes) {
            this.rootNodes = updatedNodes;
            this.filteredUris = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.results.search', async () => {
            const response = await vscode.window.showInputBox({
                ignoreFocusOut: false,
                password: false,
                placeHolder: 'Search . . . ',
                prompt: 'Search Term',
                title: 'Search Term',
            });
            if (!response) return;
            return this.searchBarValueWasUpdated(response, true, true, true, true);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.results.openResult', async (location: vscode.Location) => {
            if (location.uri.fsPath.toLowerCase().endsWith('.wtnote')) {
                const options: vscode.NotebookDocumentShowOptions = {
                    preview: false,
                    viewColumn: await determineAuxViewColumn(extension.ExtensionGlobals.notebook.getNote.bind(extension.ExtensionGlobals.notebook)),
                    preserveFocus: false,
                };
                vscode.commands.executeCommand('vscode.openWith', location.uri, 'wt.notebook', options)
                return;
            }

            // Called when a file location node is clicked in the results tree, opens the location in the editor
            const doc = await vscode.workspace.openTextDocument(location.uri);
            const editor = await showTextDocumentWithPreview(doc);
            editor.selections = [ new vscode.Selection(location.range.start, location.range.end) ];
            return editor.revealRange(location.range);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.results.showNode', async (node: SearchNode<MatchedTitleNode>) => {
            // Called when a MatchedTitleNode is clicked in the outline tree,
            // When the matched title is the title of a fragment, opens that in the editor
            // Otherwise, reveals that node in the Outline / Scratch Pad / Recycling Bin / Notebook view
            
            // Notebook or scratch pad or fragment: open in editor
            if (
                node.node.linkNode.source === 'notebook' || 
                node.node.linkNode.source === 'scratch' || 
                node.node.linkNode.node.data.ids.type === 'fragment'
            ) {
                const doc = await vscode.workspace.openTextDocument(node.getUri());
                return showTextDocumentWithPreview(doc);
            }

            // Outline or Recycling (when type is not fragment), then reveal the node 
            //      in its view
            let provider: UriBasedView<OutlineNode>;
            switch (node.node.linkNode.source) {
                case 'outline': provider = extension.ExtensionGlobals.outlineView; break;
                case 'recycle': provider = extension.ExtensionGlobals.recyclingBinView; break;
            }
            provider.view.reveal(node.node.linkNode.node);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wtSearch.results.revealNodeInOutline", async (node: SearchNode<SearchNodeKind>) => {

            const nodeResult = await vagueNodeSearch(node.getUri());
            if (nodeResult.node === null || nodeResult.source === null) return;

            if (nodeResult.source === 'notebook') {
                extension.ExtensionGlobals.notebook.view.reveal(nodeResult.node, {
                    expand: true,
                    focus: false,
                    select: true
                });
                return;
            }

            let provider: UriBasedView<OutlineNode>;
            switch (nodeResult.source) {
                case 'outline': provider = extension.ExtensionGlobals.outlineView; break;
                case 'recycle': provider = extension.ExtensionGlobals.recyclingBinView; break;
                case 'scratch': provider = extension.ExtensionGlobals.scratchPadView; break;
            }
            provider.view.reveal(nodeResult.node);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wtSearch.results.hideNode", (node: SearchNode<SearchNodeKind>) => {
            this.filteredUris.push(node.getUri());
            this.refresh();
        }));
    }

    public async searchBarValueWasUpdated (
        searchBarValue: string, 
        useRegex: boolean, 
        caseInsensitive: boolean, 
        matchTitles: boolean, 
        wholeWord: boolean
    ) {
        // Use `withProgress` pointing at this viewId to show the user that there is 
        //      something going on with the search
        return vscode.window.withProgress<void>({
            location: { viewId: SearchResultsView.viewId },
        }, async () => {
            // Grep results
            const grepResults: vscode.Location[] = [];
            for await (const result of grepExtensionDirectory(searchBarValue, useRegex, caseInsensitive, wholeWord)) {
                if (result === null) return this.searchCleared();
                grepResults.push(result[0]);
        
                // Create file system-esque tree from the grep results
                const fsTree = await createFileSystemTree(grepResults);
        
                // Create a node tree based off the file system tree
                const searchResults = await recreateNodeTree(fsTree, matchTitles);
                if (!searchResults) return this.searchCleared();
        
                // Filter empty nodes and nodes with single results
                const filteredTree = cleanNodeTree(searchResults);
        
                // Pair up all MatchedTitleNodes with their paired SearchFileNode or SearchContainerNode, if one exists
                const finalPairedTree = pairMatchedTitlesToNeighborNodes(filteredTree);
                this.refresh(finalPairedTree);
        
            } 
            if (grepResults.length === 0) return this.searchCleared();
        });
    }

    public async searchCleared () {
        this.refresh([]);
    }
    
    async getTreeItem (element: SearchNode<SearchNodeKind>): Promise<vscode.TreeItem> {
        // File location nodes link to a location in a document, and have more complicated labels and tooltips
        if (element.node.kind === 'fileLocation') {
            return {
                id: uuid(),
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
            if (element.node.linkNode.source === 'notebook' || element.node.linkNode.node.data.ids.type === 'fragment') {
                icon = new vscode.ThemeIcon('edit');
            }
            else {
                icon = new vscode.ThemeIcon('folder-opened');
            }
            return {
                id: uuid(),
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
            id: uuid(),
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
            return this.rootNodes.filter(root => !this.filteredUris.find(filtered => compareFsPath(root.getUri(), filtered)));
        }
        return (await element.getChildren(false, ()=>{}))
            .filter(child => !this.filteredUris.find(filtered => compareFsPath(child.getUri(), filtered)));
    }

    async getParent (element: SearchNode<SearchNodeKind>): Promise<SearchNode<SearchNodeKind> | null> {
        const parentUri = element.getParentUri();
        if (!parentUri) return null;
        return this.getTreeElementByUri(parentUri);
    }
}


/*

overwrite ctrl+shift+h to open in writing tool search

do highlighting in the editor equivalent to vscode search

*/