import * as vscode from 'vscode';
import { HasGetUri, UriBasedView } from '../outlineProvider/UriBasedView';
import { SearchContainerNode, FileResultNode, SearchNode, createFileSystemTree, recreateNodeTree, FileResultLocationNode, cleanNodeTree } from './processGrepResults';
import { Workspace } from '../workspace/workspaceClass';
import { executeGitGrep } from '../miscTools/help';
import * as extension from '../extension';
import { randomUUID } from 'crypto';


export type SearchNodeKind = SearchContainerNode | FileResultNode | FileResultLocationNode;

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
                placeHolder: 'plordamble',
                prompt: 'Search Term',
                title: 'Search Term',
                value: 'plordamble',
                valueSelection: [0, 'plordamble'.length]
            });
            if (!response) return;

            const reg = new RegExp(response, 'gi');
            const grepResults = await executeGitGrep(reg);
            if (!grepResults) return;
            const fsTree = await createFileSystemTree(grepResults);
            const searchResults = await recreateNodeTree(fsTree);
            if (!searchResults) return;
            const filteredTree = cleanNodeTree(searchResults);
            this.rootNodes = filteredTree;
            this.refresh();
        });

        vscode.commands.registerCommand('wt.wtSearch.results.openResult', async (location: vscode.Location) => {
            const doc = await vscode.workspace.openTextDocument(location.uri);
            const editor = await vscode.window.showTextDocument(doc);
            editor.selections = [ new vscode.Selection(location.range.start, location.range.end) ];
            return editor.revealRange(location.range);
        });
    }

    public async updateSearchBar (searchRegex: RegExp) {
        const grepResults = await executeGitGrep(searchRegex);
        if (!grepResults) return;
        const fsTree = await createFileSystemTree(grepResults);
        const searchResults = await recreateNodeTree(fsTree);
        if (!searchResults) return;
        const filteredTree = cleanNodeTree(searchResults);
        this.rootNodes = filteredTree;
        this.refresh();
    }

    public async searchCleared () {
        this.rootNodes = [];
        this.refresh();
    }
    
    getTreeItem (element: SearchNode<SearchNodeKind>): vscode.TreeItem | Thenable<vscode.TreeItem> {
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
        
        return {
            id: randomUUID(),
            label: element.getLabel(),
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            resourceUri: element.getUri(),
            tooltip: element.getTooltip(),
            description: element.description
        }
    }

    async getChildren (
        element?: SearchNode<SearchNodeKind> | undefined
    ): Promise<SearchNode<SearchNodeKind>[]> {
        if (!element) return this.rootNodes;
        return element.getChildren(false, ()=>{});
    }

    async getParent (element: SearchNode<SearchNodeKind>): Promise<SearchNode<SearchNodeKind> | null> {
        const parentUri = element.getParentUri();
        if (!parentUri) return null;
        return this.getTreeElementByUri(parentUri);
    }
    
}