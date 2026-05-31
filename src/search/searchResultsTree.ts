import * as vscode from 'vscode';
import { HasGetUri, UriBasedView } from '../outlineProvider/UriBasedView';
import { Workspace } from '../workspace/workspaceClass';
import { Extension } from   '../extension';
import { v4 as uuid } from 'uuid';
import { grepExtensionDirectory, grepSingleFile } from '../miscTools/grepper/grepExtensionDirectory';
import { FileResultLocationNode, FileResultNode, MatchedMetadataNode, SearchContainerNode, SearchNode, SearchNodeTemporaryText } from './searchResultsNode';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { __, addSingleWorkspaceEdit, capitalize, chunkArray, compareFsPath, determineAuxViewColumn, formatFsPathForCompare, getFsPathKey, getFullJSONStringFromLocation, getJSONContext, isSubdirectory, JSONContextInfo, setFsPathKey, showTextDocumentWithPreview, UriFsPathFormatted, vagueNodeSearch } from '../miscTools/help';
import { ConfigDocMatchInfo, ConfigNodeInfo, FileName, CreateSearchResults as SearchNodeGenerator } from './searchNodeGenerator';
import { Timed } from '../timedView';
import { SearchNodeKind, SearchResultsView } from './searchResultsView';
import { SearchContext } from './searchBarView';
import * as vscodeUri from 'vscode-uri';

export type ResultInfo = {
    kind: 'regular',
    uri: vscode.Uri,
    results: vscode.Range[],
    configResults?: ConfigNodeInfo,
} | {
    kind: 'paired',
    uri: vscode.Uri,
    configResults: ConfigNodeInfo,
}| {
    // Used when there is a match in a .wtnote "title" property, 
    //      OR in a .config "title" or "description" property
    // AND when there are NO matches in the corresponding
    //      fragment or .wtnote regular text areas
    kind: 'metadata',
    uri: vscode.Uri,
    configResults: ConfigNodeInfo,
}

export class SearchResultsTree 
    extends UriBasedView<SearchNode<SearchNodeKind>>
    implements 
        vscode.TreeDataProvider<SearchNode<SearchNodeKind>>
{
    private static viewId = 'wt.wtSearch.results';
    public filteredUris: (vscode.Uri | vscode.Location)[];
    public results: [vscode.Location, string][];
    public groupedResults: ResultInfo[];
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
        this.groupedResults = [];
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

    async refresh(updatedNodes?: SearchNode<SearchContainerNode>[], filteredUris?: (vscode.Uri | vscode.Location)[]): Promise<void> {
        this.rootNodes = updatedNodes || [];
        this.filteredUris = filteredUris || [];
        this.editorVersions = {};
        if (this.rootNodes.length === 0) {
            this.results = [];
        }
        this.searchResultsView.updateDecoationsIfViewIsVisible();
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
            
            const {
                useWholeWord, 
                useRegex, 
                useCaseInsensitive, 
                useMatchTitles,
                useIgnoreStyleCharacters,
                useNodeDescriptions,
            } = Extension.searchBarView.getSearchContext();
            Extension.searchBarView.updateSearchBarValue(response);
            vscode.commands.executeCommand('workbench.view.extension.wtSearch');
            return this.searchBarValueWasUpdated(response, useRegex, useCaseInsensitive, useMatchTitles, useWholeWord, useNodeDescriptions, useIgnoreStyleCharacters, new vscode.CancellationTokenSource().token);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.results.openSearch', async () => {
            let selectedText: string | null = null;
            let editor = vscode.window.activeTextEditor;
            if (editor && !editor.selection.isEmpty) {
                selectedText = editor.document.getText(editor.selection);
                const {
                    useWholeWord, 
                    useRegex, 
                    useCaseInsensitive, 
                    useMatchTitles,
                    useIgnoreStyleCharacters,
                    useNodeDescriptions,
                } = Extension.searchBarView.getSearchContext();
                await vscode.commands.executeCommand('workbench.view.Extension.wtSearch');
                Extension.searchBarView.updateSearchBarValue(selectedText);
                return this.searchBarValueWasUpdated(selectedText, useRegex, useCaseInsensitive, useMatchTitles, useWholeWord, useNodeDescriptions, useIgnoreStyleCharacters, new vscode.CancellationTokenSource().token);
            }
            else {
                return vscode.commands.executeCommand('workbench.view.Extension.wtSearch');
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.results.openResult', async (location: vscode.Location) => {
            if (location.uri.fsPath.toLowerCase().endsWith('.wtnote')) {
                const options: vscode.NotebookDocumentShowOptions = {
                    preview: false,
                    viewColumn: await determineAuxViewColumn(Extension.notebookPanel.getNote.bind(Extension.notebookPanel)),
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

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.results.showNode', async (node: SearchNode<MatchedMetadataNode>) => {
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
                case 'outline': provider = Extension.outlineView; break;
                case 'recycle': provider = Extension.recyclingBinView; break;
            }
            provider.expandAndRevealOutlineNode(node.node.linkNode.node);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wtSearch.results.revealNodeInOutline", async (node: SearchNode<SearchNodeKind>) => {

            const nodeResult = await vagueNodeSearch(node.getUri());
            if (nodeResult.node === null || nodeResult.source === null) return;

            if (nodeResult.source === 'notebook') {
                return;
            }

            let provider: UriBasedView<OutlineNode>;
            switch (nodeResult.source) {
                case 'outline': provider = Extension.outlineView; break;
                case 'recycle': provider = Extension.recyclingBinView; break;
                case 'scratch': provider = Extension.scratchPadView; break;
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

    private async groupResults (results: [vscode.Location, string][], createTitleNodes: boolean, createNodeDescriptionNodes: boolean): Promise<ResultInfo[]> {

        const groupedResults: Record<UriFsPathFormatted, ResultInfo> = {};

        const allResultUris: Record<UriFsPathFormatted, vscode.Uri> = {};
        results.forEach(res => allResultUris[res[0].uri.fsPath] = res[0].uri);

        // Matches inside the text of raw text files can be handled easily since we know all the info we need to know
        //      about the match just from the URI itself
        const groupedFragmentUris: Record<UriFsPathFormatted, {
            uri: vscode.Uri,
            ranges: vscode.Range[]
        }> = {};

        // Matches inside of JSON formatted files need to be handled differently than raw text matches
        // Because a match in the JSON needs to be explored further to find the context within the JSON
        //      structure of that match in order to (1) link it to a OutlineNode (if the match is in a 
        //      .config file) and to (2) display the match correctly in the search results tree
        type JSONMatchInfo = {
            jsonDocumentUri: vscode.Uri,
            jsonDocumentParentUri: vscode.Uri,
            jsonDocument: vscode.TextDocument,
            ranges: vscode.Range[],
        };
        const groupedConfigUris: Record<UriFsPathFormatted, JSONMatchInfo> = {};
        const groupedNoteUris: Record<UriFsPathFormatted, JSONMatchInfo> = {};

        for (const [ matchedLocation, _ ] of results) {
            const fmtUri = formatFsPathForCompare(matchedLocation.uri);

            const fileName = vscodeUri.Utils.basename(matchedLocation.uri).toLocaleLowerCase();
            const extension = vscodeUri.Utils.extname(matchedLocation.uri).toLocaleLowerCase();
            if (fileName === '.config' || extension === '.wtnote') {
                if (fmtUri in groupedConfigUris) {
                    groupedConfigUris[fmtUri].ranges.push(matchedLocation.range);
                }
                else {

                    const jsonMatchInfo: JSONMatchInfo = {
                        jsonDocumentUri: matchedLocation.uri,
                        jsonDocumentParentUri: vscodeUri.Utils.dirname(matchedLocation.uri),
                        jsonDocument: await vscode.workspace.openTextDocument(matchedLocation.uri),
                        ranges: [ matchedLocation.range ]
                    };

                    if (fileName === '.config') {
                        groupedConfigUris[fmtUri] = jsonMatchInfo;
                    }
                    else if (extension === '.wtnote') {
                        groupedNoteUris[fmtUri] = jsonMatchInfo;
                    }
                }
            }
            else {
                if (fmtUri in groupedFragmentUris) {
                    groupedFragmentUris[fmtUri].ranges.push(matchedLocation.range);
                }
                else {
                    groupedFragmentUris[fmtUri] = {
                        uri: matchedLocation.uri,
                        ranges: [ matchedLocation.range ],
                    };
                }
            }
        }

        // Simple to group results for fragment files -- can be inserted into the grouped results, per uri,
        //      right away because fragment files do not have any metadata to look at besides the uri itself
        for (const [ fmtUri, fragmentResults ] of Object.entries(groupedFragmentUris)) {
            groupedResults[fmtUri] = {
                kind: 'regular',
                uri: fragmentResults.uri,
                results: fragmentResults.ranges,
            };
        }

        // Now, for dealing with .config and .wtnote JSON-formatted files
        // A much more complicated issue simply because we need to understand the *context* of where the result came from the JSON

        
        // Iterate over the grouped entries for config files
        for (const [ _, configInfo ] of Object.entries(groupedConfigUris)) {
            
            // PROBLEM: ripgrep searches of JSON files will return a line number and character index of the line where it found the match
            //      in the JSON, but NOT any other meta information about *where* structurally that result came from
            // We have information about the matched data but we need to somehow link that to an actual OutlineNode in the Outline / Recycling Bin
            //      / Scratch Pad views.  To do that, we need to construct a URI
            // (NOTE: we have the URI of the .config file, obviously, coming from ripgrep itself, and from that we can obviously figure out the
            //      parent of the OutlineNode in question, but but what we need is the fileName that the matched string in the config file comes from
            // Rhe format of a .config file is:
            // So... if a .config file looks like this:
            //      { "fragment.wt": { 
            //          "title": "Some ||matched text||",
            //          "description": "Some other ||matched text|| and then even some more ||matched text||",
            //          ...etc
            //      } }
            // )
            // We may know the start and end offset of <"Some other ||matched text|| and then even some more ||matched text||">
            //      or  <"Some ||matched text||"> JSON strings inside of the full document text
            // ... but, what we need is the key of the surrounding object (we need "fragment.wt")
            // Solution: helper function `getFullJSONStringFromLocation` will 
            //      1) confirm that the matched location is in fact inside of a JSON string in the file, not some
            //          structural characters
            //      2) return information about the start and end of the complete string where the matched text
            //          was found
            // helper function `getJSONContext` takes information from an index in a JSON document and returns
            //      basic structural information about where that index is situated in the JSON stucture.  
            // Namely, for VALUEs of JSON objects (not keys), it will return:
            //      1) The key property name that maps it to the object it's in
            //      2) The start and end locations of the object it exists inside
            // From this, we can go from the string value what was matched to the object that surrounds it
            //      (So, using the example above, if we use getFullJSONStringFromLocation on ||matched text||,
            //          we get the start offset of the "Some ||matched text||" string, and calling getJSONContext
            //          on that we get the object key ("title") as well as the start and end of the INNER
            //          object { "title": "Some ||matched text||", "description": "Some other ||matched text|| and then even some more ||matched text||"}
            //      We can then repeat the process calling getJSONContext on the start index of the inner object we found above to get the 
            //          key that maps THAT object ("fragment.wt") as well as the start and end indexes of the OUTER object (BOF and EOF))
            
            const configUri = configInfo.jsonDocumentUri;
            const parentUri = configInfo.jsonDocumentParentUri;
            
            const configDoc = configInfo.jsonDocument;
            const fullText = configDoc.getText();
            
            // Currently, we have indexes into the .config files themself, but what we need is to re-group them
            //      grouped by the fileName itself
            // To do that, we need to extract the file name:
            const configResults: Record<FileName, ConfigNodeInfo> = {};
            for (const matchedRange of configInfo.ranges) {
                
                    // From the matched text search outwards for the JSON string that surrounds it
                    const location = new vscode.Location(configUri, matchedRange);
                    const originalMatchedJSONStringInfo = getFullJSONStringFromLocation(configDoc, fullText, location);

                    // getFullJSONStringFromLocation returns null if the index into the file does not point to a JSON string
                    if (originalMatchedJSONStringInfo === null) continue;
                    
                    // Now, search outwards from the surrounding string to find the JSON config entry
                    const context = getJSONContext(configDoc, fullText, originalMatchedJSONStringInfo.startOff - 1);
                    if (context === null) continue;

                    // The matched text must be inside of a mapped value inside of a JSON object
                    if (context.kind !== 'objectPropertyValue') continue;
                    
                    // The key property name of the matched text's string must be title or description
                    // (And we need to be matching on title or description, obviously)
                    if (!(context.keyName === 'title' && createTitleNodes) && !(context.keyName === 'description' && createNodeDescriptionNodes)) {
                        continue;
                    }
            
                    // Get the JSON context of the starting character of the config entry, this will find the key name of the 
                    //      property that the config is mapped to -- which is the file name of the document
                    const configEntryStartOffset = configDoc.offsetAt(context.objectRange.start);
                    const configContext = getJSONContext(configDoc, fullText, configEntryStartOffset);
                    if (configContext === null) continue;
                    if (configContext.kind !== 'objectPropertyValue') continue;
            
                    // Finally, as long as the getJSONContext call returned a objectProperty value, the key of that value will 
                    //      be the the file name for the matched node
                    const fileName = configContext.keyName;
                    const childUri = vscode.Uri.joinPath(parentUri, fileName);
                    
                    // If the child node has not been inserted into the nodeInfo record of the config file record, then we insert it here
                    // (Since we are looping over multiple results within a single .config file, there may be more results than one )
                    if (!(fileName in configResults)) {
                        const childNodeSearch = await vagueNodeSearch(childUri);
                        if (childNodeSearch.node === null || childNodeSearch.source === 'notebook') continue;
                        
                        const prefix = capitalize(childNodeSearch.node.data.ids.type); 
                        const title = childNodeSearch.node.data.ids.display;
                        const description = childNodeSearch.node.data.ids.description;
                        const ordering = childNodeSearch.node.data.ids.ordering;
            
                        configResults[fileName] = {
                            uri: childUri,
                            linkNode: childNodeSearch,
                            title: title,
                            prefix: prefix,
                            description: description,
                            ordering: ordering,
                            descriptionHighlightInfo: [],
                            titleHighlightInfo: [],
                        }
                    }
            
                    // The location of the highlighted text is right now indexed starting at the beginning of .config
                    //      file, but the highlights in the search view tree must be indexed starting at 0
                    // Shift the highlights in location.range backwards by the start of the JSON string in which they
                    //      originated
            
                    // Get range document indexed
                    const highlightJSONRange   = location.range;
                    const highlightJSONStart   = configDoc.offsetAt(highlightJSONRange.start);
                    const highlightJSONEnd     = configDoc.offsetAt(highlightJSONRange.end);
            
                    // Get the offset that needs to be shifted back
                    const jsonStringOffset     = originalMatchedJSONStringInfo.startOff;
            
                    // Reconstruct highlights
                    const highlightZeroIndexed: [ number, number ] = [
                        highlightJSONStart - jsonStringOffset,
                        highlightJSONEnd - jsonStringOffset,
                    ];
            
                    // Add data to the existing match
                    if (context.keyName === 'title' && createTitleNodes) {
                        configResults[fileName].titleHighlightInfo.push(highlightZeroIndexed);
                    }
                    else if (context.keyName === 'description' && createNodeDescriptionNodes) {
                        configResults[fileName].descriptionHighlightInfo.push(highlightZeroIndexed);
                    }
                
    
            }

            // Now that we have all our results for this .config file grouped by file name, we need to insert them into
            //      the final groupedResults record
            // That involves either 
            //      (1) pairing the result to an exising `ResultInfo` object if one exists for the 
            //              matched URI 
            //      (2) creating a new `metadata` type `ResultInfo` object just for this lone
            //              metadata entry, not for any text matches, 
            //      (3) pairing the result to a not-yet-existing `ResultInfo` object for cases where
            //              where the paired not doesn't have any matches but a CHILD of that node
            //              DOES have matches
            //          This covers a corner case when constructing the result tree where a matched metadata
            //              node cannot have children, but they do need to have children in the case
            //              where there are matches further down the lone
            for (const [ _, nodeInfo ] of Object.entries(configResults)) {
                const nodeUri = nodeInfo.uri;

                // If there is an existing fragment uri result for this uri already, then pair this
                //      nodeInfo with that result (case 1 above)
                const fmtUri = formatFsPathForCompare(nodeUri);
                if (fmtUri in groupedResults) {
                    groupedResults[fmtUri].configResults = nodeInfo;
                    continue;
                }

                // Otherwise, search for any node that is a subdirectory of this (see case 3 above)
                const substringNode = Object.values(allResultUris).find(resultInfo => {
                    return isSubdirectory(nodeUri, resultInfo);
                });

                if (substringNode) {
                    groupedResults[fmtUri] = {
                        kind: 'paired',
                        uri: nodeUri,
                        configResults: nodeInfo
                    };
                }
                // Or create a new metadata node (case 2 above)
                else {
                    groupedResults[fmtUri] = {
                        kind: 'metadata',
                        uri: nodeUri,
                        configResults: nodeInfo
                    };
                }
            }
        }

        // Now, handle .wtnote files
        // Altogether simple than .config files because we don't need to search the context of the document as much
        //      because we already know the URI of the file we're searching for (the .wtnote file itself)

        for (const [ noteUri, noteInfo ] of Object.entries(groupedNoteUris)) {
            // Follow the same logic above to retrieve the key property name of the matched text's surrounding string

            const configUri = noteInfo.jsonDocumentUri;
            const configDoc = noteInfo.jsonDocument;
            const fullText = configDoc.getText();

            const results: vscode.Range[] = [];
            for (const matchedRange of noteInfo.ranges) {
                // From the matched text search outwards for the JSON string that surrounds it
                const location = new vscode.Location(configUri, matchedRange);
                const originalMatchedJSONStringInfo = getFullJSONStringFromLocation(configDoc, fullText, location);

                // getFullJSONStringFromLocation returns null if the index into the file does not point to a JSON string
                if (originalMatchedJSONStringInfo === null) continue;
                
                // Now, search outwards from the surrounding string to find the JSON config entry
                const context = getJSONContext(configDoc, fullText, originalMatchedJSONStringInfo.startOff - 1);
                if (context === null) continue;

                // The matched text must be inside of a mapped value inside of a JSON object
                if (context.kind !== 'objectPropertyValue') continue;

                // All data (at least all data that we're searching for) comes from JSON strings mapped by a "text"
                //      key name, so if the key name of the matched text is not "text", we can ignore this match
                if (context.keyName !== 'text') {
                    continue;
                }

                // No other information is needed for now
                // TOOD: maybe eventually add more structure to the results for WTNotes (like the subheading and what not)
                // TODO: maybe add a new result type specifically for the note files so the "surroundingText" stuff is cleaner
                //      in the search results tree
                results.push(matchedRange);
            }

            groupedResults[noteUri] = {
                kind: 'regular',
                uri: noteInfo.jsonDocumentUri,
                results: results
            };
        }

        return Object.values(groupedResults).sort((a, b) => {
            return formatFsPathForCompare(a.uri).localeCompare(formatFsPathForCompare(b.uri));
        });
    }

    public async searchBarValueWasUpdated (
        searchBarValue: string, 
        useRegex: boolean, 
        useCaseInsensitive: boolean, 
        useMatchTitles: boolean, 
        useWholeWord: boolean,
        useMatchNodeDescriptions: boolean,
        useIgnoreStyleCharacters: boolean,
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
                results = await grepExtensionDirectory(searchBarValue, useRegex, useCaseInsensitive, useWholeWord, useIgnoreStyleCharacters, cancellationToken);
                if (results === null || results.length === 0) return this.searchCleared();
                if (cancellationToken.isCancellationRequested) return;
            }
            catch (err: any) {
                Extension.searchBarView.setSearchBarError(searchBarValue, `${err}`);
                return;
            }

            this.results = results;
            this.groupedResults = await this.groupResults(this.results, useMatchTitles, useMatchNodeDescriptions);

            const searchNodeGenerator = new SearchNodeGenerator();
            let currentTree: SearchNode<SearchContainerNode>[] | null = null;

            const chunkedResults = chunkArray(this.groupedResults, 25);
            for (const chunk of chunkedResults) {
                if (cancellationToken.isCancellationRequested) return;

                for (const result of chunk) {
                    if (cancellationToken.isCancellationRequested) return;

                    // Iteratively insert every result in this chunk into the search result generator
                    currentTree = await searchNodeGenerator.insertResult(result, cancellationToken);
                }
                // At the end of every chunk, refresh the tree
                currentTree && this.refresh(currentTree);
                this.searchResultsView.updateDecoationsIfViewIsVisible();
            }

            // Once the entire tree for this search is completed, start creating 'title' nodes
            //      to display any matches within the title of snips/chapters/fragments
            this.refresh(currentTree || undefined);
            this.searchResultsView.updateDecoationsIfViewIsVisible();
        4});
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
        else if (element.node.kind === 'matchedMetadata') {
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
                    uri: Extension.rootPath
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