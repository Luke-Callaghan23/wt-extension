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
import { SearchNodeKind, SearchResultsView } from './searchResultsView';

export class SearchResultsTree 
    extends UriBasedView<SearchNode<SearchNodeKind>>
    implements 
        vscode.TreeDataProvider<SearchNode<SearchNodeKind>>
{
    private static viewId = 'wt.wtSearch.results';
    public filteredUris: (vscode.Uri | vscode.Location)[];
    public results: [vscode.Location, string][];
    public editorVersions: Record<UriFsPathFormatted, number> = {};

    constructor (
        protected workspace: Workspace,
        protected context: vscode.ExtensionContext,
        protected searchResultsView: SearchResultsView
    ) {
        super("Search Results");
        this.rootNodes = [];
        this.filteredUris = [];
        this.results = [];
    }

    
    private _onDidChangeTreeData: vscode.EventEmitter<SearchNode<SearchNodeKind> | undefined> = new vscode.EventEmitter<SearchNode<SearchNodeKind> | undefined>();
    readonly onDidChangeTreeData: vscode.Event<SearchNode<SearchNodeKind> | undefined> = this._onDidChangeTreeData.event;
    
    async initialize() {
        const view = vscode.window.createTreeView(SearchResultsTree.viewId, { 
            treeDataProvider: this,
            showCollapseAll: true, 
            canSelectMany: true,
        });
        this.context.subscriptions.push(view);
        this.registerCommands();
        this.view = view;

        // Add or remove the search results highlights depending on whether the view is visible and enabled
        this.context.subscriptions.push(view.onDidChangeVisibility((event) => {
            // If try update returns false, then remove highlights
            if (!this.searchResultsView.updateDecoationsIfViewIsVisible(true)) {
                this.searchResultsView.clearDecorations();
            }
            // If it returns true it already does the updates so nothing else to do here
        }));

        await this.initUriExpansion(SearchResultsTree.viewId, this.view, this.context);
    }

    async refresh(updatedNodes?: SearchNode<SearchContainerNode>[], filteredUris?: typeof this.filteredUris): Promise<void> {
        if (updatedNodes) {
            this.rootNodes = updatedNodes;
            this.filteredUris = filteredUris || [];
            this.editorVersions = {};
            if (updatedNodes.length === 0) {
                this.results = [];
            }
            this.searchResultsView.updateDecoationsIfViewIsVisible();
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
            
            const [ _, __, wholeWord, useRegex, caseInsensitive, matchTitles ] = await vscode.commands.executeCommand<[string, string, boolean, boolean, boolean, boolean]>('wt.wtSearch.getSearchContext');
            await vscode.commands.executeCommand('wt.wtSearch.updateSearchBarValue', response);
            vscode.commands.executeCommand('workbench.view.extension.wtSearch');
            return this.searchBarValueWasUpdated(response, useRegex, caseInsensitive, matchTitles, wholeWord, new vscode.CancellationTokenSource().token);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.results.openSearch', async () => {
            let selectedText: string | null = null;
            let editor = vscode.window.activeTextEditor;
            if (editor && !editor.selection.isEmpty) {
                selectedText = editor.document.getText(editor.selection);
                const [ _, __, wholeWord, useRegex, caseInsensitive, matchTitles ] = await vscode.commands.executeCommand<[string, string, boolean, boolean, boolean, boolean]>('wt.wtSearch.getSearchContext');
                await vscode.commands.executeCommand('wt.wtSearch.updateSearchBarValue', selectedText);
                vscode.commands.executeCommand('workbench.view.extension.wtSearch');
                return this.searchBarValueWasUpdated(selectedText, useRegex, caseInsensitive, matchTitles, wholeWord, new vscode.CancellationTokenSource().token);
            }
            else {
                return vscode.commands.executeCommand('workbench.view.extension.wtSearch');
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.results.openResult', async (location: vscode.Location) => {
            if (location.uri.fsPath.toLowerCase().endsWith('.wtnote')) {
                const options: vscode.NotebookDocumentShowOptions = {
                    preview: false,
                    viewColumn: await determineAuxViewColumn(extension.ExtensionGlobals.notebookPanel.getNote.bind(extension.ExtensionGlobals.notebookPanel)),
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
            provider.expandAndRevealOutlineNode(node.node.linkNode.node);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wtSearch.results.revealNodeInOutline", async (node: SearchNode<SearchNodeKind>) => {

            const nodeResult = await vagueNodeSearch(node.getUri());
            if (nodeResult.node === null || nodeResult.source === null) return;

            if (nodeResult.source === 'notebook') {
                extension.ExtensionGlobals.notebookPanel.view.reveal(nodeResult.node, {
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
            return provider.expandAndRevealOutlineNode(nodeResult.node);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wtSearch.results.hideNode", (node: SearchNode<SearchNodeKind>) => {
            this.filteredUris.push(node.getLocation());
            this.refresh();
            this.searchResultsView.updateDecoationsIfViewIsVisible();
            for (const active of vscode.window.visibleTextEditors) {
                setFsPathKey(active.document.uri, active.document.version, this.editorVersions);
            }
        }));

    }

    public async searchBarValueWasUpdated (
        searchBarValue: string, 
        useRegex: boolean, 
        caseInsensitive: boolean, 
        matchTitles: boolean, 
        wholeWord: boolean,
        cancellationToken: vscode.CancellationToken
    ) {

        // Use `withProgress` pointing at this viewId to show the user that there is 
        //      something going on with the search
        return vscode.window.withProgress<void>({
            location: { viewId: SearchResultsTree.viewId },
        }, async () => {
            // Grep results
            
            let results: [vscode.Location, string][] | null;
            try {
                results = await grepExtensionDirectory(searchBarValue, useRegex, caseInsensitive, wholeWord, cancellationToken);
                if (results === null || results.length === 0) return this.searchCleared();
                if (cancellationToken.isCancellationRequested) return;
            }
            catch (err: any) {
                vscode.commands.executeCommand('wt.wtSearch.searchError', searchBarValue, `${err}`);
                return;
            }
            this.results = results;

            const searchNodeGenerator = new SearchNodeGenerator();
            let currentTree: SearchNode<SearchContainerNode>[] | null = null;

            const chunkedResults = chunkArray(results, 25);
            for (const chunk of chunkedResults) {
                if (cancellationToken.isCancellationRequested) return;

                for (const result of chunk) {
                    if (cancellationToken.isCancellationRequested) return;

                    // Iteratively insert every result in this chunk into the search result generator
                    currentTree = await searchNodeGenerator.insertResult(result[0], matchTitles, cancellationToken);
                }
                // At the end of every chunk, refresh the tree
                currentTree && this.refresh(currentTree);
                this.searchResultsView.updateDecoationsIfViewIsVisible();
            }

            // Once the entire tree for this search is completed, start creating 'title' nodes
            //      to display any matches within the title of snips/chapters/fragments
            currentTree = await searchNodeGenerator.createTitleNodes(cancellationToken);
            currentTree && this.refresh(currentTree);
            this.searchResultsView.updateDecoationsIfViewIsVisible();
        });
    }



    public async replace (originalText: string, replacedTerm: string, isRegex: boolean): Promise<boolean> {
        // For all locations that are not children of filtered uris, create and add the 
        //      workspace edit to a vscode.WorkspaceEdit object
        const edits = new vscode.WorkspaceEdit();
        const urisUpdated = new Set<string>();
        for (const [ location, actualMatchedText ] of this.results) {
            // Check if filtered or not
            if (this.isLocationFiltered(location)) {
                continue;
            }


            let replacement: string;
            if (isRegex) {
                // Capture groups:
                // If the user is doing a replacement on a search string that **is** a regex, and that regex contains capture groups
                //      surrounded by parentheses
                // The user can take segments of each individual matched location's captured values and use them in the replacement
                //      by using $ plus an index.
                // Ex: 
                //      Search regex           = 'I want pi(z*)a (now)?'
                //      Replace string         = 'You're making me sleep $1 $2'
                //      
                //      Fragment file 1        = 'I want pizzzzzzzzzzzza'
                //      Fragment file 1 result = 'You're making me sleep zzzzzzzzzzzz '
                //      Fragment file 2        = 'I want piza now'
                //      Fragment file 2 result = 'You're making me sleep  now'


                // Create a new regex containing only the text currently in the search bar, and
                //      use that to search the actual matched text
                // This generates an exec array with details about capture groups embedded within
                //      the search text
                const captureMyself = new RegExp('^' + originalText + '$');
                const execArray: RegExpExecArray | null = captureMyself.exec(actualMatchedText)!;

                // Do replacements
                replacement = execArray.reduce((acc, captured, index) => {
                    // In instances of **OPTIONAL** capture groups, they will appear in the exec array
                    //      even if they do not appear in the string
                    // They will be undefined
                    // But, since we are doing string manipulation later down in the function we will just
                    //      treat it as if it was an empty string (Otherwise, the string 'undefined' will appear
                    //      in spaces we probably don't want them to)
                    if (captured === undefined || captured === null) {
                        captured = '';
                    }

                    // Cast capture group index as string for easier manipulation
                    const captureGroupIndex = `${index}`;   

                    // Searching greedily for as many repeating dollar signs as possible,
                    //      plus the capture group index
                    const search = '\\$+' + captureGroupIndex;
                    const searchReg = new RegExp(search, 'gi');

                    return acc.replaceAll(searchReg, match => {
                        // Since the regex is greedily capturing all dollar signs in a row, we know that if there is more than
                        //      once dollar sign in the 'match' text provided by this function then the capture is "escaped"
                        // (You can escape a capture group index by adding an extra dollar sign in front)

                        // Test this by replacing the capture group index with an empty string and getting the length
                        // If greater than one, then there is more than one dollar sign in the replace string here
                        //      so, no replacements are necessary
                        if (match.replace(captureGroupIndex, "").length > 1) {
                            return match;
                        }

                        // Otherwise, return the current string that was captured by the incoming regex
                        return captured;
                    });
                }, replacedTerm);
            }
            else {
                // Otherwise, just replace using the original provided value
                replacement = replacedTerm;
            }
            await addSingleWorkspaceEdit(edits, location, replacement);
            urisUpdated.add(location.uri.fsPath);
        }

        // Confirm with user
        const resp = await vscode.window.showInformationMessage(`Are you sure you want to replace ${edits.size} instances of '${originalText}' to '${replacedTerm}' in ${urisUpdated.size} files?`, {
            detail: `
WARNING: For best results.  Save ALL open .wtnote notebook files before doing this.  If the edit is large enough, I'd also recommend doing a git commit before doing this as well.
            `,
            modal: true,
        }, "Yes");
        if (resp !== 'Yes') return false;

        // And apply
        return vscode.workspace.applyEdit(edits, {
            isRefactoring: true,
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
            const res = this.rootNodes.filter(root => !this.isUriFiltered(root.getUri()));
            return res;
        }

        const children = (await element.getChildren(false, ()=>{}));
        return children
            .filter(child => !this.isLocationFiltered(child.getLocation()));
    }

    async getParent (element: SearchNode<SearchNodeKind>): Promise<SearchNode<SearchNodeKind> | null> {
        const parentUri = element.getParentUri();
        if (!parentUri) return null;
        return this.getTreeElementByUri(parentUri);
    }

    // /home/lcallaghan/wtenvs/fotbb/data/chapters/chapter-b80dzv110/snips/snip-b83x1tgy0

    public isUriFiltered (uri: vscode.Uri): boolean {
        for (const filtered of this.filteredUris) {
            // CASE: COMPARING LOCATION VS URI
            if ('uri' in filtered) {
                // if a location within a URI is filtered, that does NOT mean that the entire
                //      uri is filtered!!!!
                continue;
            }
            // CASE: COMPARING URI VS URI
            else {
                // Check if the file uris are exactly equal or if the uri is a in a subdirectory
                //      of the filtered uri
                if (compareFsPath(filtered, uri) || isSubdirectory(filtered, uri)) {
                    return true;
                }
            }
        }
        return false;
    }

    public isLocationFiltered (location: (vscode.Location | vscode.Uri)): boolean {

        // Check if the input is a vscode.Location or a vscode.Uri by seeing if it has a 'uri' field in it
        // If it has 'uri', then it must be a vscode.Location
        // Otherwise, it is a vscode.Uri, and we call `isUriFiltered`
        if (!('uri' in location)) {
            return this.isUriFiltered(location);
        }
        for (const filtered of this.filteredUris) {
            // CASE: COMPARING LOCATION VS LOCATION
            if ('uri' in filtered) {
                // Check if the location uris are exactly equal, and if the ranges are exactly equal
                if (compareFsPath(filtered.uri, location.uri) && filtered.range.isEqual(location.range)) {
                    return true;
                }
            }
            // CASE: COMPARING URI VS URI
            else {
                // Check if the file uris are exactly equal or if the replace location uri is a in a subdirectory
                //      of the filtered uri
                if (compareFsPath(filtered, location.uri) || isSubdirectory(filtered, location.uri)) {
                    return true;
                }
            }
        }
        return false;
    }
}


/*

overwrite ctrl+shift+h to open in writing tool search

do highlighting in the editor equivalent to vscode search

*/