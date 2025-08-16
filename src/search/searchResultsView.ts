import * as vscode from 'vscode';
import { HasGetUri, UriBasedView } from '../outlineProvider/UriBasedView';
import { Workspace } from '../workspace/workspaceClass';
import * as extension from '../extension';
import { v4 as uuid } from 'uuid';
import { grepExtensionDirectory, grepSingleFile } from '../miscTools/grepper/grepExtensionDirectory';
import { FileResultLocationNode, FileResultNode, MatchedTitleNode, SearchContainerNode, SearchNode, SearchNodeTemporaryText } from './searchResultsNode';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { __, addSingleWorkspaceEdit, chunkArray, compareFsPath, determineAuxViewColumn, formatFsPathForCompare, getFsPathKey, isSubdirectory, setFsPathKey, showTextDocumentWithPreview, UriFsPathFormatted, vagueNodeSearch } from '../miscTools/help';
import { CreateSearchResults as SearchNodeGenerator } from './searchNodeGenerator';
import { Timed } from '../timedView';
import { BounceOnIt } from '../miscTools/bounceOnIt';
import { SearchResultsTree } from './searchResultsTree';
import { nodeGrep } from '../miscTools/grepper/nodeGrep';

const SearchHighlight = vscode.window.createTextEditorDecorationType(__<vscode.DecorationRenderOptions>({
    backgroundColor: new vscode.ThemeColor('editor.findMatchBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
    overviewRulerColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    isWholeLine: false,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
}))

export type SearchNodeKind = 
    SearchContainerNode
    | FileResultNode
    | FileResultLocationNode
    | SearchNodeTemporaryText
    | MatchedTitleNode;

export class SearchResultsView 
extends 
    BounceOnIt<[vscode.Uri | vscode.TextDocument]>
implements 
    Timed
{
    private searchTree: SearchResultsTree
    constructor (
        protected workspace: Workspace,
        protected context: vscode.ExtensionContext
    ) {
        super();
        this.searchTree = new SearchResultsTree(this.workspace, this.context, this);
        this.enabled = true;
    }

    public async initialize ()  {
        await  this.searchTree.initialize();

        // Add or remove the search results highlights depending on whether the view is visible and enabled
        this.context.subscriptions.push(this.searchTree.view.onDidChangeVisibility((event) => {
            // If try update returns false, then remove highlights
            if (!this.updateDecoationsIfViewIsVisible()) {
                for (const editor of vscode.window.visibleTextEditors) {
                    editor.setDecorations(SearchHighlight, []);
                }
            }
            // If it returns true it already does the updates so nothing else to do here
        }));

        const searchResultsUpdateWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(extension.rootPath, `data/{chapters,snips}/**/*.{wt,wtnote}`),
            false, false,false
        );
        searchResultsUpdateWatcher.onDidCreate(this.triggerDebounce.bind(this));
        searchResultsUpdateWatcher.onDidChange(this.triggerDebounce.bind(this));
        searchResultsUpdateWatcher.onDidDelete(this.triggerDebounce.bind(this));
        this.context.subscriptions.push(searchResultsUpdateWatcher);

        this.context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((ev) => this.triggerDebounce(ev.document)));
    }

    public async searchBarValueWasUpdated (
        searchBarValue: string, 
        useRegex: boolean, 
        caseInsensitive: boolean, 
        matchTitles: boolean, 
        wholeWord: boolean,
        cancellationToken: vscode.CancellationToken
    ) {
        return this.searchTree.searchBarValueWasUpdated(searchBarValue, useRegex, caseInsensitive, matchTitles, wholeWord, cancellationToken);
    }
    

    public async replace (originalText: string, replacedTerm: string, isRegex: boolean): Promise<boolean> {
        return this.searchTree.replace(originalText, replacedTerm, isRegex);
    }

    public async searchCleared () {
        this.searchTree.searchCleared();
    }
    

    // /home/lcallaghan/wtenvs/fotbb/data/chapters/chapter-b80dzv110/snips/snip-b83x1tgy0

    enabled: boolean;
    getUpdatesAreVisible(): boolean {
        return this.searchTree.view.visible;
    }

    async update (editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        const target = editor.document.uri;
        const targetFmt = formatFsPathForCompare(target);
        
        const documentOnlyResults = this.searchTree.results.filter(([loc, _]) => formatFsPathForCompare(loc.uri) === targetFmt);
        if (documentOnlyResults.length === 0) return;

        const finalResults: vscode.Range[] = [];
        for (const  [ location, _ ] of documentOnlyResults) {
            if (this.searchTree.isLocationFiltered(location)) continue;
            finalResults.push(location.range);
        }
        editor.setDecorations(SearchHighlight, finalResults);
    }

    protected async debouncedUpdate (cancellationToken: vscode.CancellationToken, updated: vscode.Uri | vscode.TextDocument): Promise<void> {
        return this.recalculateDocumentResults(cancellationToken, updated);
    }

    private async recalculateDocumentResults (cancellationToken: vscode.CancellationToken, updated: vscode.Uri | vscode.TextDocument): Promise<void> {
        const updatedUri = 'uri' in updated ? updated.uri : updated;
        
        const [ latestSearchBarValue, _, wholeWord, useRegex, caseInsensitive, matchTitles ] = await vscode.commands.executeCommand<[string, string, boolean, boolean, boolean, boolean]>('wt.wtSearch.getSearchContext');
        if (latestSearchBarValue === '') {
            return;
        }
        

        // Remove filters and results for any location or uri that is this document, or a parent of this document
        // Results will be added back by the end of the function -- but filters will not
        // (This because if the user is updating the content of the editor, it is extremely difficult 
        //      to track which matches have been filtered, which are new, which should be highlighted, etc.)
        // (So, clearing out filters is a better solution than trying to track and guess which filters should remain)
        const shouldRetainLocation = (location: vscode.Location | vscode.Uri): boolean => {
            const cmp: vscode.Uri = 'uri' in location ? location.uri : location;
            const eq =  compareFsPath(cmp, updatedUri);
            const child = isSubdirectory(cmp, updatedUri);
            return !eq && !child;
        };
        
        this.searchTree.filteredUris = this.searchTree.filteredUris.filter(shouldRetainLocation);
        this.searchTree.results = this.searchTree.results.filter(result => shouldRetainLocation(result[0]));

        // TODO: if we remove a filter for a parent uri, should we add back filters for all other 
        //      children that are not in a direct line to this document???
        // TODO: very niche case

        this.searchTree.nodeMap = {};

        const node = await this.searchTree.getTreeElementByUri(updatedUri);
        if (node) {
            const parent = await this.searchTree.getParent(node);
            if (parent && parent.node.kind === 'searchContainer') {
                const parentContainer = parent as SearchNode<SearchContainerNode>;
                
                // Search the contents map of the parent container for all nodes with the same uri as the 
                //      deleted file
                let deleteKeys: string[] = [];
                for (const [ nodeKey, node ] of Object.entries(parentContainer.node.contents)) {
                    if (compareFsPath(node.node.uri, updatedUri)) {
                        deleteKeys.push(nodeKey);
                    }
                }
        
                // Remove those entries from the parent container
                for (const deleteKey of deleteKeys) {
                    delete parentContainer.node.contents[deleteKey];
                }
            }
        }
        
        const fileResults = 'uri' in updated
            ? await nodeGrep(updated, latestSearchBarValue, useRegex, caseInsensitive, wholeWord, cancellationToken)
            : await grepSingleFile(updatedUri, latestSearchBarValue, useRegex, caseInsensitive, wholeWord, cancellationToken);

        
        if (!fileResults) return;
        
        // Create a search node generator -- with the current root data as seed information
        const searchNodeGenerator = new SearchNodeGenerator(this.searchTree.rootNodes as SearchNode<SearchContainerNode>[]);

        let currentTree: SearchNode<SearchContainerNode>[] | null = null;
        for (const result of fileResults) {
            if (cancellationToken.isCancellationRequested) return;

            // Iteratively insert every result in this chunk into the search result generator
            currentTree = await searchNodeGenerator.insertResult(result[0], matchTitles, cancellationToken);
        }

        // Once the entire tree for this search is completed, start creating 'title' nodes
        //      to display any matches within the title of snips/chapters/fragments
        currentTree = await searchNodeGenerator.createTitleNodes(cancellationToken);
        if (currentTree) {
            this.searchTree.refresh(currentTree);
            this.searchTree.results.push(...fileResults);
            this.updateDecoationsIfViewIsVisible();
        }
    }

    public clearDecorations () {
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(SearchHighlight, []);
        }
    }

    public updateDecoationsIfViewIsVisible (recalculateActiveEditors: boolean = false): boolean {
        if (this.searchTree.view.visible && this.enabled) {
            for (const editor of vscode.window.visibleTextEditors) {
                if (recalculateActiveEditors) {
                    // When `recalculateDocumentResults` is sent as true, then we need to delete
                    //      all entries for the current editor then recalculate them before
                    //      we re-calculate decorations
                    // `recalculateDocumentResults` is set to true when the TreeView for the 
                    //      search tree becomes visible again
                    // In this case, we don't know if the old search results for the current documents
                    //      still stand
                    this.recalculateDocumentResults (
                        new vscode.CancellationTokenSource().token,
                        editor.document
                    ).then(() => this.update(editor, []));
                }
                else {
                    // Otherwise, just redraw the decorations for the search view
                    this.update(editor, []);
                }
            }
            return true;
        }
        return false;
    }
}


/*

overwrite ctrl+shift+h to open in writing tool search

do highlighting in the editor equivalent to vscode search

*/