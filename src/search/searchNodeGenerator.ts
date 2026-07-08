import * as vscode from 'vscode';
import { __, capitalize, chunkArray, ConfigFileInfo, formatFsPathForCompare, getFullJSONStringFromLocation, getJSONContext, getRelativePath, getSurroundingTextInRange, isSubdirectory, JSONStringInfo, readDotConfig, UriFsPathFormatted, vagueNodeSearch, VagueNodeSearchResult, VagueSearchSource } from '../miscTools/help';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { Extension } from   '../extension';
import * as vscodeUri from 'vscode-uri';
import { Buff } from '../Buffer/bufferSource';
import { FileResultLocationNode, FileResultNode, MatchedMetadataNode, SearchContainerNode, SearchNode, SearchNodeTemporaryText } from './searchResultsNode';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { SearchNodeKind } from './searchResultsView';
import { assert } from 'console';
import { grepExtensionDirectory } from '../miscTools/grepper/grepExtensionDirectory';
import { NotebookCellMetadata, SerializedHeader, SerializedNote } from '../notebook/notebookApi/notebookSerializer';

export type FileSystemFormat = {
    results: number,
    folders: ResultFolder
}

export type FileName = string;
export type ResultFile = {
    kind: 'file',
    ext: string;
    locations: {
        location: vscode.Location;
        surroundingText: string;
        surroundingTextHighlight: [ number, number ];
        largerSurrounding: string;
        largerSurroundingHighlight: [ number, number ];
    }[];
}


export type ResultFolder = {
    kind: 'folder',
    contents: {
        [index: FileName]: ResultFolder | ResultFile;
    }
};


export function createLabelFromTitleAndPrefix (title: string, prefix: string): string {
    if (prefix.length === 0) return title;
    return `(${prefix}) ${title}`;
}


type Categories = 'chapters' | 'snips' | 'scratchPad' | 'recycle' | 'notebook';
type ConfigProvider = (uri: vscode.Uri) => Promise<ConfigDetails | null>;
type ConfigDetails = {
    title: string,
    description?: string,
    prefix: string,
    ordering: number
};

// NOTE: these objects are at the .config level!
//      they are NOT at the child node level
export type ConfigDocMatchInfo = {
    uri: vscode.Uri,
    parent: SearchNode<SearchContainerNode>,
    parentLabels: string[],
    dotConfigDoc: vscode.TextDocument,

    // Information about search matches within the entries of this .config
    // Mapping between fileName of entry and information about the matches within the 
    //      METADATA of that node
    nodeInfo: Record<FileName, ConfigNodeInfo>;
};

export type ConfigNodeInfo = {
    uri: vscode.Uri,
    linkNode: MatchedMetadataNode['linkNode'],
    prefix: string,
    title: string,
    ordering: number,
    description?: string,
    titleHighlightInfo: [ number, number ][],
    descriptionHighlightInfo: [ number, number ][]
};

export type WTNoteCellMatchInfo = {
    ordering: number,
    cellText: string,
    cellTextHighlightInfo: [ number, number ][],
};

export type WTNoteHeaderMatchInfo = {
    ordering: number,
    headerText: string, 
    results: WTNoteCellMatchInfo[],
};

export type ResultInfo = {
    kind: 'regular',
    uri: vscode.Uri,
    results: vscode.Range[],
    configResults?: ConfigNodeInfo,
} | {
    kind: 'paired',
    uri: vscode.Uri,
    configResults: ConfigNodeInfo,
} | {
    // Used when there is a match in a .wtnote "title" property, OR in a .config "title" or "description" property
    // AND when there are NO matches in the corresponding fragment or .wtnote regular text areas
    kind: 'metadata',
    uri: vscode.Uri,
    configResults: ConfigNodeInfo,
} | {
    kind: 'wtnote',
    uri: vscode.Uri,
    noteTitle: string,
    headerMatches: WTNoteHeaderMatchInfo[]
};

export class CreateSearchResults {
    
    private docMap: Record<string, vscode.TextDocument>;
    private rootCategoryNodes: Record<Categories, SearchNode<SearchContainerNode>>;
    private configNodes: Record<UriFsPathFormatted, ConfigDocMatchInfo>;

    constructor (seedData?: SearchNode<SearchContainerNode>[]) {
        this.configNodes = {};
        this.rootCategoryNodes = {
            'chapters': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(Extension.rootPath, 'data', 'chapters'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(Extension.rootPath, 'data'),
                title: 'Chapters',
                prefix: '',
                ordering: 0,
            }),
            'snips': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(Extension.rootPath, 'data', 'snips'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(Extension.rootPath, 'data'),
                title: 'Work Snips',
                prefix: '',
                ordering: 0,
            }),
            'scratchPad': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(Extension.rootPath, 'data', 'scratchPad'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(Extension.rootPath, 'data'),
                title: 'Scratch Pad',
                prefix: '',
                ordering: 0,
            }),
            'recycle': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(Extension.rootPath, 'data', 'recycling'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(Extension.rootPath, 'data'),
                title: 'Recycling Bin',
                prefix: '',
                ordering: 0,
            }),
            'notebook': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(Extension.rootPath, 'data', 'notebook'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(Extension.rootPath, 'data'),
                title: 'Work Notebook',
                prefix: '',
                ordering: 0,
            }),
        };
        this.docMap = {};

        if (seedData) {
            // If we are provided with some seed data, then search through that seed data for any of the "base" category nodes that 
            //      were created above.  If any titles match (titles are a good enough key to match on given that seed data should always
            //      be root data anyways), then replace the initialized data above with the seed data
            for (const seed of seedData) {
                for (const [ entryKey, rootValue ] of Object.entries(this.rootCategoryNodes)) {
                    const entryKeyCategory = entryKey as Categories;
                    if (seed.node.title === rootValue.node.title) {
                        this.rootCategoryNodes[entryKeyCategory] = seed;
                    }
                }
            }
        }
    }

    public async refreshResults (
        results: [vscode.Location, string][],
        useMatchTitles: boolean, 
        useMatchNodeDescriptions: boolean,
        cancellationToken?: vscode.CancellationToken,

        // Results are inserted iteratively 25 results at a time
        // For a cleaner experience to the user, it may be better to update the tree visually
        //      after each 25 results are added
        // So, provide an optional hook to let the caller to refresh the tree in these intervals
        iterativeRefresh?: (currentTree: SearchNode<SearchContainerNode>[] | null) => void
    ): Promise<SearchNode<SearchContainerNode>[] | null> {

        const groupedResults = await this.groupResults(results, useMatchTitles, useMatchNodeDescriptions);
        if (cancellationToken?.isCancellationRequested) return null;
        if (!groupedResults) return null;
    
        let currentTree: SearchNode<SearchContainerNode>[] | null = null;
    
        const chunkedResults = chunkArray(groupedResults, 25);
        for (const chunk of chunkedResults) {
            if (cancellationToken?.isCancellationRequested) return null;
    
            for (const result of chunk) {
                if (cancellationToken?.isCancellationRequested) return null;
    
                // Iteratively insert every result in this chunk into the search result generator
                currentTree = await this.insertResult(result, cancellationToken);
            }
            iterativeRefresh?.(currentTree);
        }
        return currentTree;
    }

    public async updateFileResults (
        uri: vscode.Uri,
        fileResults: [vscode.Location, string][],
        existingSearchNode: SearchNode<SearchContainerNode | FileResultNode | FileResultLocationNode | SearchNodeTemporaryText | MatchedMetadataNode> | null,
        cancellationToken?: vscode.CancellationToken
    ): Promise<SearchNode<SearchContainerNode>[] | null> {
        
        let existingConfigInfo: ConfigNodeInfo | undefined;
        if (existingSearchNode?.node 
            && (existingSearchNode.node.kind === 'file' || existingSearchNode.node.kind === 'searchContainer') 
            && existingSearchNode.node.pairedMatchedMetadataNode
        ) {
            existingConfigInfo = existingSearchNode.node.pairedMatchedMetadataNode.node;
        }
        else if (existingSearchNode?.node && existingSearchNode.node.kind === 'matchedMetadata') { 
            existingConfigInfo = existingSearchNode.node;
        }

        // Create a search node generator -- with the current root data as seed information
        let resultInfo: ResultInfo;
        if (fileResults.length === 0 && existingConfigInfo) {
            resultInfo = {
                kind: 'metadata',
                uri: uri,
                configResults: existingConfigInfo,
            };
        }
        else {
            // Since we know all results will just be for one document, we can recreate a ResultInfo object manually here
            resultInfo = {
                kind: 'regular',
                uri: uri,
                results: fileResults.map(([res, _]) => {
                    return res.range;
                }),
                configResults: existingConfigInfo
            };
        }

        // Iteratively insert every result in this chunk into the search result generator
        return this.insertResult(resultInfo, cancellationToken);
    }

    
    private async groupResults (
        results: [vscode.Location, string][], 
        createTitleNodes: boolean, 
        createNodeDescriptionNodes: boolean,
        cancellationToken?: vscode.CancellationToken
    ): Promise<ResultInfo[] | null> {

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
            if (cancellationToken?.isCancellationRequested) return null;

            const fmtUri = formatFsPathForCompare(matchedLocation.uri);

            const fileName = vscodeUri.Utils.basename(matchedLocation.uri).toLocaleLowerCase();
            const extension = vscodeUri.Utils.extname(matchedLocation.uri).toLocaleLowerCase();
            if (fileName === '.config' || extension === '.wtnote') {
                if (fmtUri in groupedConfigUris) {
                    groupedConfigUris[fmtUri].ranges.push(matchedLocation.range);
                }
                else if (fmtUri in groupedNoteUris) {
                    groupedNoteUris[fmtUri].ranges.push(matchedLocation.range);
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
            if (cancellationToken?.isCancellationRequested) return null;
            
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
                if (cancellationToken?.isCancellationRequested) return null;
                
                    // From the matched text search outwards for the JSON string that surrounds it
                    const location = new vscode.Location(configUri, matchedRange);
                    const originalMatchedJSONStringInfo = getFullJSONStringFromLocation(configDoc, fullText, location);

                    // getFullJSONStringFromLocation returns null if the index into the file does not point to a JSON string
                    if (originalMatchedJSONStringInfo === null) continue;
                    if (cancellationToken?.isCancellationRequested) return null;
                    
                    // Now, search outwards from the surrounding string to find the JSON config entry
                    const context = getJSONContext(configDoc, fullText, originalMatchedJSONStringInfo.startOff - 1);
                    if (context === null) continue;
                    if (cancellationToken?.isCancellationRequested) return null;

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
                    if (cancellationToken?.isCancellationRequested) return null;
            
                    // Finally, as long as the getJSONContext call returned a objectProperty value, the key of that value will 
                    //      be the the file name for the matched node
                    const fileName = configContext.keyName;
                    const childUri = vscode.Uri.joinPath(parentUri, fileName);
                    
                    // If the child node has not been inserted into the nodeInfo record of the config file record, then we insert it here
                    // (Since we are looping over multiple results within a single .config file, there may be more results than one )
                    if (!(fileName in configResults)) {
                        const childNodeSearch = await vagueNodeSearch(childUri);
                        if (childNodeSearch.node === null || childNodeSearch.source === 'notebook') continue;
                        if (cancellationToken?.isCancellationRequested) return null;
                        
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
            // That involves either:
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
                if (cancellationToken?.isCancellationRequested) return null;
                const nodeUri = nodeInfo.uri;

                // If there is an existing fragment uri result for this uri already, then pair this
                //      nodeInfo with that result (case 1 above)
                const fmtUri = formatFsPathForCompare(nodeUri);
                if (fmtUri in groupedResults && groupedResults[fmtUri].kind !== 'wtnote') {
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
            if (cancellationToken?.isCancellationRequested) return null;

            // Follow the same logic above to retrieve the key property name of the matched text's surrounding string

            const configUri = noteInfo.jsonDocumentUri;
            const configDoc = noteInfo.jsonDocument;
            const fullText = configDoc.getText();

            const resultsByHeader: Record<string, WTNoteHeaderMatchInfo> = {};
            for (const matchedRange of noteInfo.ranges) {
                // From the matched text search outwards for the JSON string that surrounds it
                const location = new vscode.Location(configUri, matchedRange);
                const originalMatchedJSONStringInfo = getFullJSONStringFromLocation(configDoc, fullText, location);

                // getFullJSONStringFromLocation returns null if the index into the file does not point to a JSON string
                if (originalMatchedJSONStringInfo === null) continue;
                if (cancellationToken?.isCancellationRequested) return null;
                
                // Now, search outwards from the surrounding string to find the JSON config entry
                const context = getJSONContext(configDoc, fullText, originalMatchedJSONStringInfo.startOff - 1);
                if (context === null) continue;
                if (cancellationToken?.isCancellationRequested) return null;

                // The matched text must be inside of a mapped value inside of a JSON object
                if (context.kind !== 'objectPropertyValue') continue;

                // All data (at least all data that we're searching for) comes from JSON strings mapped by a "text"
                //      key name, so if the key name of the matched text is not "text", we can ignore this match
                if (context.keyName !== 'text') {
                    continue;
                }
                
                // Get the JSON context of the starting character of the config entry, this will find the key name of the 
                //      property that the config is mapped to -- which is the file name of the document
                const configEntryStartOffset = configDoc.offsetAt(context.objectRange.start);
                const cellContext = getJSONContext(configDoc, fullText, configEntryStartOffset);

                if (cellContext?.kind !== 'arrayMember') continue;

                const arrayStartOff = configDoc.offsetAt(cellContext.arrayRange.start);
                const cellsArrayContext = getJSONContext(configDoc, fullText, arrayStartOff);
                if (cellsArrayContext?.kind !== 'objectPropertyValue') continue;
                if (cellsArrayContext.keyName !== 'cells') continue;

                const headerObjJSON = configDoc.getText(cellsArrayContext.objectRange);
                const header: SerializedHeader = JSON.parse(headerObjJSON);

                const cellIdx = header.cells.findIndex(({ text }) => text === originalMatchedJSONStringInfo.jsonString);

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
                
                const headerText = header.headerText;

                if (!(headerText in resultsByHeader)) {
                    resultsByHeader[headerText] = {
                        headerText: headerText,
                        ordering: header.headerOrder,
                        results: [ {
                            ordering: cellIdx,
                            cellText: originalMatchedJSONStringInfo.jsonString,
                            cellTextHighlightInfo: [ highlightZeroIndexed ]
                        } ]
                    };
                }
                else {
                    const foundTarget = resultsByHeader[headerText].results.find(({ cellText }) => cellText === originalMatchedJSONStringInfo.jsonString);
                    if (foundTarget) {
                        foundTarget.cellTextHighlightInfo.push(highlightZeroIndexed)
                    }
                    else {
                        resultsByHeader[headerText].results.push({
                            ordering: cellIdx,
                            cellText: originalMatchedJSONStringInfo.jsonString,
                            cellTextHighlightInfo: [ highlightZeroIndexed ]
                        });
                    }
                }
            }

            const serializedNote: SerializedNote = JSON.parse(noteInfo.jsonDocument.getText());
            groupedResults[noteUri] = {
                kind: 'wtnote',
                uri: noteInfo.jsonDocumentUri,
                noteTitle: serializedNote.title.text,
                headerMatches: Object.values(resultsByHeader)
            };
        }
        if (cancellationToken?.isCancellationRequested) return null;

        return Object.values(groupedResults).sort((a, b) => {
            return formatFsPathForCompare(a.uri).localeCompare(formatFsPathForCompare(b.uri));
        });
    }

    private getConfigProviders (): Record<Categories, ConfigProvider> {

        const mainConfigProvider = (view: UriBasedView<OutlineNode>) => {
            return async (uri: vscode.Uri): Promise<ConfigDetails | null> => {
                const node = await view.getTreeElementByUri(uri);
                if (!node) return null;

                
                if (node.data.ids.type !== 'container') {
                    return {
                        prefix: capitalize(node.data.ids.type), 
                        description: node.data.ids.description,
                        title: node.data.ids.display,
                        ordering: node.data.ids.ordering
                    }
                }
                else {
                    return {
                        prefix: '', 
                        title: "Chapter Snips Container",
                        description: node.data.ids.description,
                        ordering: node.data.ids.ordering
                    };
                }
            };
        };

        return {
            'chapters': mainConfigProvider(Extension.outlineView),
            'snips': mainConfigProvider(Extension.outlineView),
            'scratchPad': mainConfigProvider(Extension.scratchPadView),
            'recycle': mainConfigProvider(Extension.recyclingBinView),
            // For the notebook, since OutlineNodes are not used, we can just take the "title" in the note as the label
            'notebook': async (uri: vscode.Uri) => {
                const note = Extension.notebookPanel.getNote(uri);
                if (!note) return null;
                return {
                    prefix: 'Note', 
                    title: note.title,
                    ordering: 0
                };
            }
        }
    }

    private getResultsCount (node: SearchNode<SearchContainerNode | FileResultNode | MatchedMetadataNode>): number {
        if (node.node.kind === 'file') {
            // Results in the file
            const contentResultsCount = node.node.locations.length;

            // Results in the metadata of the file (title and description)
            const configResultsCount = node.node.pairedMatchedMetadataNode
                ? node.node.pairedMatchedMetadataNode.node.titleHighlightInfo.length
                    + node.node.pairedMatchedMetadataNode.node.descriptionHighlightInfo.length
                : 0;
            return contentResultsCount + configResultsCount;
        }
        else if (node.node.kind === 'matchedMetadata') {
            return node.node.titleHighlightInfo.length + node.node.descriptionHighlightInfo.length
        }
        else if (node.node.kind === 'searchContainer') {
            node.node.results = Object.values(node.node.contents).reduce((acc, element) => acc + this.getResultsCount(element), 0);
            return node.node.results;
        }
        else throw 'Unreachable';
    }

    // TODO: this function was originally written when SearchContainerNode.contents was an arry
    //      it has since been changed to a Record<fileName, SearchNode>.  
    // TODO: if this function is even un-deprecated, then you have to remove @ts-ignore and 
    //      update it to use the record
    // Filter tree rules:
    //      If there is a folder node with only one child, replace the folder with that child
    //      Add the removed folder's name to the child's description
    //      Recurse until the child is a 'file' node
    // Filter tree is always called with a Folder node as the argument
    private filterTree (node: SearchNode<SearchContainerNode>, root: boolean, description?: string[]): SearchNode<SearchContainerNode | FileResultNode | MatchedMetadataNode> {
        const createDescription = (includeOwn: boolean=false) => {
            description = description || [];
            if (includeOwn) {
                description.push(createLabelFromTitleAndPrefix(node.node.title, node.node.prefix));
            }
            return description.join(' > ');
        }
        
        // @ts-ignore
        if (node.node.contents.length === 1 && !root) {

            const nextup = node.node.contents[0];
            if (nextup.node.kind !== 'searchContainer') {
                // Push the label of this folder node into the description of the child, and return the file child
                nextup.description = createDescription(true);
                return nextup;
            }

            // Push the label of this folder into the description of the child, and recurse
            const nextDescription = description 
                ? [ ...description, createLabelFromTitleAndPrefix(node.node.title, node.node.prefix) ]
                : [ createLabelFromTitleAndPrefix(node.node.title, node.node.prefix) ];
            return this.filterTree(nextup as SearchNode<SearchContainerNode>, false, nextDescription);
        }

        // Iterate over folder node's contents
        node.description = createDescription();
        // @ts-ignore
        node.node.contents = node.node.contents.map(childNode => {
            if (childNode.node.kind === 'file' || childNode.node.kind === 'matchedMetadata') {
                return childNode;
            }
            else if (childNode.node.kind === 'searchContainer') {
                // Recursively filter all the folder children of this node
                return this.filterTree(childNode as SearchNode<SearchContainerNode>, false, description);
            }
            // @ts-ignore
            else throw `filter tree unexpected child node kind '${childNode.node.kind}'`;
        });
        return node;
    }

    private async createLocationNode (fileUri: vscode.Uri, locationInFile: vscode.Location, parentLabels: string[], title: string, prefix: string): Promise<SearchNode<FileResultLocationNode>> {
        const fsUri = formatFsPathForCompare(locationInFile.uri);
        const cachedDoc = this.docMap[fsUri] || await vscode.workspace.openTextDocument(locationInFile.uri);
        this.docMap[fsUri] = cachedDoc;

        let fullText: string;
        let locationStart: number;
        let locationEnd: number;
        if (locationInFile.uri.fsPath.toLowerCase().endsWith('.wtnote')) {

            // WTNOTE documents are formatted using JSON, so we need to extract the full JSON string of the location
            //      this search found
            const jsonSubstring = getFullJSONStringFromLocation(cachedDoc, cachedDoc.getText(), locationInFile);
            fullText = jsonSubstring.jsonString;
            locationStart = cachedDoc.offsetAt(locationInFile.range.start) - jsonSubstring.startOff;
            locationEnd = cachedDoc.offsetAt(locationInFile.range.end) - jsonSubstring.startOff;
        }
        else {
            // Otherwise pull from the cached doc map
            fullText = cachedDoc.getText();
            locationStart = cachedDoc.offsetAt(locationInFile.range.start);
            locationEnd = cachedDoc.offsetAt(locationInFile.range.end);
        }

        const smallSurrounding = getSurroundingTextInRange(fullText, locationStart, locationEnd, [ 20, 100 ]);
        const largerSurrounding = getSurroundingTextInRange(fullText, locationStart, locationEnd, 400);

        return new SearchNode<FileResultLocationNode>({
            kind: 'fileLocation',
            location: locationInFile,
            parentUri: fileUri,
            parentLabels: [ ...parentLabels, createLabelFromTitleAndPrefix(title, prefix) ],
            surroundingText: smallSurrounding.surroundingText,
            surroundingTextHighlight: smallSurrounding.highlight,
            largerSurroundingText: largerSurrounding.surroundingText,
            largerSurroundingTextHighlight: largerSurrounding.highlight,
            uri: vscodeUri.URI.from({
                ...fileUri,
                fragment: `#L${locationInFile.range.start.line},${locationInFile.range.start.character}-${locationInFile.range.end.line},${locationInFile.range.end.character}`
            })
        })
    }

    private cleanNodeTree (): SearchNode<SearchContainerNode>[] {
        const cleanedTrees: SearchNode<SearchContainerNode>[] = [];
        for (const searchTree of Object.values(this.rootCategoryNodes)) {
            const updatedTree = this.cleanContainerNode(searchTree);
            if (updatedTree !== null) {
                cleanedTrees.push(updatedTree);
            }
        }
        return cleanedTrees;
    }

    private cleanContainerNode (containerNode: SearchNode<SearchContainerNode>): SearchNode<SearchContainerNode> | null {
        // If the root node does not have any children, we do not want to keep that category in the 
        //      search results view, so entirely skip over it
        const results = this.getResultsCount(containerNode);
        if (results === 0) {
            return null;
        }

        for (const [ fileName, content ] of Object.entries(containerNode.node.contents)) {
            if (content.node.kind === 'searchContainer') {
                const updated = this.cleanContainerNode(content as SearchNode<SearchContainerNode>);
                if (updated === null) {
                    delete containerNode.node.contents[fileName];
                }
                else {
                    containerNode.node.contents[fileName] = updated;
                }
            }
        }
        return containerNode;
    }

    // Incrementally create and add new search results to an existing tree of search results
    private async insertResult (
        result: ResultInfo,
        cancellationToken?: vscode.CancellationToken
    ): Promise<SearchNode<SearchContainerNode>[] | null> {

        if (result.kind === 'wtnote') {

            const notebookCategory = this.rootCategoryNodes['notebook'];
            const notebook = Extension.notebookPanel.getNote(result.uri);
            if (!notebook) return this.cleanNodeTree();
            
            const noteContainer: SearchContainerNode = {
                kind: 'searchContainer',
                uri: result.uri,
                ordering: Object.entries(notebookCategory.node.contents).length,
                contents: {},
                parentUri: notebookCategory.node.uri,
                parentLabels: [ notebookCategory.node.title ],
                prefix: 'Note',
                results: 0,
                title: result.noteTitle,
            };

            for (const header of result.headerMatches) {
                const headerNode: SearchContainerNode = {
                    kind: "searchContainer",
                    uri: result.uri,
                    ordering: header.ordering,
                    contents: {},
                    parentLabels: [ notebookCategory.node.title, result.noteTitle ],
                    parentUri: result.uri,
                    prefix: "",
                    results: 0,
                    title: header.headerText
                };

                for (const cell of header.results) {
                    const cellNode: MatchedMetadataNode = {
                        kind: 'matchedMetadata',
                        linkNode: {
                            node: notebook,
                            source: 'notebook'
                        },
                        descriptionHighlightInfo: [],
                        prefix: "",
                        ordering: cell.ordering,
                        parentLabels: [ notebookCategory.node.title, result.noteTitle, header.headerText ],
                        parentUri: result.uri,
                        title: cell.cellText,
                        titleHighlightInfo: cell.cellTextHighlightInfo,
                        uri: result.uri,
                    };
                    headerNode.contents[cell.cellText] = new SearchNode(cellNode);
                }
                noteContainer.contents[header.headerText] = new SearchNode(headerNode);
            }
            notebookCategory.node.contents[formatFsPathForCompare(result.uri)] = new SearchNode(noteContainer);
            return this.cleanNodeTree();
        }

        // All search locations besides 'notebook' use a UriBasedView with an OutlineNode as the Node
        //      so for all three of these we can use the same function to extract labels

        const resultUri = result.uri;
        
        const path = getRelativePath(resultUri);
        let relativePath: string[] = [];
        const pathSegments = path.split("/");

        // First two segments should be '' and 'data' (/data/chapters/chapter-/snips/snip-/fragment-.wt => '', 'data', 'chapters', ... etc.)
        //      but the first folder should the 'categories' folder (chapters/snips/etc.), so skip past them here
        if (pathSegments[0] === '') pathSegments.shift();
        if (pathSegments[0] === 'data') {
            relativePath.push('data');
            pathSegments.shift();
        }

        // Confirm the first folder is the category folder
        const category: Categories = pathSegments.shift() as Categories;
        if (!this.rootCategoryNodes[category]) {
            return null;
        }

        relativePath.push(category);
        const configProviders = this.getConfigProviders();
        
        let parentLabels: string[] = [];
        let parentNode: SearchNode<SearchContainerNode> = this.rootCategoryNodes[category];
        let parentUri: vscode.Uri = parentNode.node.uri;

        // Iterate each segment of the path of the added location
        for (let index = 0; index < pathSegments.length; index++) {

            const segment = pathSegments[index];
            relativePath.push(segment);

            const uri = vscode.Uri.joinPath(Extension.rootPath, ...relativePath);
            const isLeaf = index === pathSegments.length - 1;

            const config = await configProviders[category](uri);
            if (!config) continue;
            
            let pairedMatchedMetadataNode: SearchNode<MatchedMetadataNode> | undefined;
            if (isLeaf && result.configResults) {
                pairedMatchedMetadataNode = new SearchNode<MatchedMetadataNode>({
                    kind: 'matchedMetadata',
                    uri: resultUri,
                    linkNode: result.configResults.linkNode,
                    prefix: result.configResults.prefix,
                    title: result.configResults.title,
                    description: result.configResults.description,
                    ordering: result.configResults.ordering,
                    parentLabels: parentLabels,
                    parentUri: parentUri,
                    titleHighlightInfo: result.configResults.titleHighlightInfo,
                    descriptionHighlightInfo: result.configResults.descriptionHighlightInfo,
                });
            }

            // Create a metadata-only node
            if (isLeaf && pairedMatchedMetadataNode && result.kind !== 'regular') { 

                const configResults = result.configResults;
                if (parentNode.node.contents[segment] && (parentNode.node.contents[segment].node.kind === 'file' || parentNode.node.contents[segment].node.kind === 'searchContainer')) {
                    (parentNode.node.contents[segment].node as SearchContainerNode | FileResultNode).pairedMatchedMetadataNode = pairedMatchedMetadataNode;
                    break;
                }
                
                if (result.kind === 'paired') {
                    parentNode.node.contents[segment] = new SearchNode<SearchContainerNode>({
                        kind: 'searchContainer',
                        uri: uri,
                        prefix: configResults.prefix,
                        title: configResults.title,
                        description: configResults.description,
                        ordering: configResults.ordering,
                        parentUri: parentUri,
                        parentLabels: parentLabels,
                        contents: {},
                        pairedMatchedMetadataNode: pairedMatchedMetadataNode,
                        results: 0
                    });
                }
                else {
                    parentNode.node.contents[segment] = pairedMatchedMetadataNode;
                }
                break;
            }

            const { prefix, title, description, ordering } = config;
            

            // If we have encountered this path segment before and added it to the node tree:
            if (parentNode.node.contents[segment]) {
                
                // If the node is a leaf (a file, rather than another directory):
                if (isLeaf) {
                    
                    // // Add this new location to the existing node for this file
                    // if (parentNode.node.contents[segment].node.kind !== 'file') {
                    //     throw 'Must be a search file node';
                    // }
                    
                    // const leafNode = parentNode.node.contents[segment] as SearchNode<FileResultNode>;
                    // for (const range of result.results) {
                    //     const location = new vscode.Location(uri, range);
                    //     leafNode.node.locations.push(await this.createLocationNode(uri, location, parentLabels, title, prefix));
                    // }

                }
                // Otherwise, nothing should be added yet
                // Just update the pointer of the parent node to the current node
                else {
                    if (parentNode.node.contents[segment].node.kind !== 'searchContainer') {
                        throw 'Must be a search container node'
                    }
                    parentLabels = [...parentNode.node.parentLabels, createLabelFromTitleAndPrefix(title, prefix)];
                    parentNode = parentNode.node.contents[segment] as SearchNode<SearchContainerNode>;
                    parentUri = parentNode.node.uri;
                }
            }
            // If this node has never been added to the node tree before
            else {
                if (isLeaf) {
                    
                    // Add a location node for each result in this fragment
                    let locations: SearchNode<FileResultLocationNode>[] = [];
                    if ('results' in result) {
                        const locationsPromises: Promise<SearchNode<FileResultLocationNode>>[] = [];
                        for (const range of result.results) {
                            const location = new vscode.Location(uri, range);
                            locationsPromises.push(this.createLocationNode(uri, location, parentLabels, title, prefix));
                        }
                        locations = await Promise.all(locationsPromises);
                    }

                    parentNode.node.contents[segment] = new SearchNode<FileResultNode>({
                        kind: 'file',
                        ext: vscodeUri.Utils.extname(uri),
                        prefix: prefix,
                        title: title,
                        parentLabels: parentLabels,
                        description: description,
                        locations: locations,
                        uri: uri,
                        parentUri: parentUri,
                        ordering: ordering,
                        pairedMatchedMetadataNode: pairedMatchedMetadataNode
                    });
                }
                else {
                    if (cancellationToken?.isCancellationRequested) return null;
                    
                    const next = new SearchNode<SearchContainerNode>({
                        kind: 'searchContainer',
                        contents: {},
                        prefix: prefix,
                        title: title,
                        parentLabels: parentLabels,
                        description: description,
                        uri: uri,
                        parentUri: parentUri,
                        results: 0,
                        ordering: ordering,
                        pairedMatchedMetadataNode: pairedMatchedMetadataNode
                    });
                    parentLabels.push(createLabelFromTitleAndPrefix(title, prefix));

                    parentNode.node.contents[segment] = next;
                    parentNode = next;
                    parentUri = parentNode.node.uri;
                }
            }
        }

        return this.cleanNodeTree();
    }
}