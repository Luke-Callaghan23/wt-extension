import * as vscode from 'vscode';
import { capitalize, ConfigFileInfo, formatFsPathForCompare, getFullJSONStringFromLocation, getJSONStringContext, getRelativePath, getSurroundingTextInRange, JSONStringInfo, readDotConfig, UriFsPathFormatted, vagueNodeSearch, VagueNodeSearchResult, VagueSearchSource } from '../miscTools/help';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { Extension } from   '../extension';
import * as vscodeUri from 'vscode-uri';
import { Buff } from '../Buffer/bufferSource';
import { FileResultLocationNode, FileResultNode, MatchedMetadataNode, SearchContainerNode, SearchNode } from './searchResultsNode';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { SearchNodeKind } from './searchResultsView';
import { assert } from 'console';



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
type ConfigDetails = {
    title: string,
    description?: string,
    prefix: string,
    ordering: number
};
type ConfigProvider = (uri: vscode.Uri) => Promise<ConfigDetails | null>;

export class CreateSearchResults {
    
    private docMap: Record<string, vscode.TextDocument>;
    private rootCategoryNodes: Record<Categories, SearchNode<SearchContainerNode>>;
    private configNodes: Record<UriFsPathFormatted, {
        uri: vscode.Uri,
        parent: SearchNode<SearchContainerNode>,
        parentLabels: string[],
        doc: vscode.TextDocument,
        titleLocationStringInfo: [JSONStringInfo, vscode.Location][],
        descriptionLocationStringInfo: [JSONStringInfo, vscode.Location][],
    }>;

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
            return node.node.locations.length;
        }
        else if (node.node.kind === 'matchedMetadata') {
            return 1;
        }
        else if (node.node.kind === 'searchContainer') {
            node.node.results = Object.values(node.node.contents).reduce((acc, element) => acc + this.getResultsCount(element), 0);
            return node.node.results;
        }
        else throw 'Unreachable';
    }


    public async createMetadataNodes (
        cancellationToken: vscode.CancellationToken
    ): Promise<SearchNode<SearchContainerNode>[] | null> {

        // For each .config file that was hit by the grepper
        for (const [ _, { uri, parent, parentLabels, doc: configDoc, descriptionLocationStringInfo, titleLocationStringInfo } ] of Object.entries(this.configNodes)) {
            
            // If the label is null but the file a .config file and we are creating title nodes, then try to create a title
            //      node for this entry in config file
            const dotConfig = await readDotConfig(uri);
            if (!dotConfig || cancellationToken.isCancellationRequested) return null;

            // Iterate over all entries of tracked by this .config file
            const createdEntriesFileNames: Set<string> = new Set<string>();
            for (const [ entryFileName, configEntry ] of Object.entries(dotConfig)) {

                
                if (cancellationToken.isCancellationRequested) return null;
                
                // If the title of the current entry we're looking at is not the same as the title that the grepper matched,
                //      then we skip over it
                const matchedTitleForThisEntryArr = titleLocationStringInfo.filter(([ jsi, _ ]) => {
                    return configEntry.title === jsi.jsonString;
                });
                const isAnyMatchedTitle = matchedTitleForThisEntryArr.length > 0;

                const matchedDescriptionForThisEntryArr = descriptionLocationStringInfo.filter(([ jsi, _ ]) => {
                    return configEntry.description === jsi.jsonString;
                });
                const isAnyMatchedDescription = matchedDescriptionForThisEntryArr.length > 0;

                if (!isAnyMatchedTitle && !isAnyMatchedDescription) continue;
                if (cancellationToken.isCancellationRequested) return null;

                // If an entry was already made for this file name, then skip over it
                if (createdEntriesFileNames.has(entryFileName)) continue;
                if (cancellationToken.isCancellationRequested) return null;

                // Now, we know that the current entry in .config corresponds with the locatuion that the grepper found:
                
                // Calculate the the highlights inside the title text -- accounts for multiple instances of the searched term in the title
                const highlightsTitle: [number, number][] = [];
                if (isAnyMatchedTitle) {
                    const matchedTitleForThisEntry = matchedTitleForThisEntryArr[0];
                    const matchedTitleForThisEntryFullString = matchedTitleForThisEntry[0].jsonString;
                    const matchedTitleForThisEntryLocation = matchedTitleForThisEntry[1];
                    
                    const highlightedTitleText = configDoc.getText(matchedTitleForThisEntryLocation.range);
                    let textSubset = matchedTitleForThisEntryFullString;
                    let startOff: number;
                    let lastSliceIndex: number = 0;
                    while ((startOff = textSubset.indexOf(highlightedTitleText)) !== -1) {
                        if (cancellationToken.isCancellationRequested) return null;
                        const nextSliceIndex = startOff + highlightedTitleText.length + lastSliceIndex;
                        highlightsTitle.push([ startOff + lastSliceIndex, nextSliceIndex ]);
                        textSubset = matchedTitleForThisEntryFullString.substring(nextSliceIndex);
                        lastSliceIndex = nextSliceIndex;
                    }
                }

                // Calculate the the highlights inside the description text -- accounts for multiple instances of the searched term in the description
                const highlightsDescription: [number, number][] = [];
                if (isAnyMatchedDescription) {
                    const matchedDescriptionForThisEntry = matchedDescriptionForThisEntryArr[0];
                    const matchedDescriptionForThisEntryFullString = matchedDescriptionForThisEntry[0].jsonString;
                    const matchedDescriptionForThisEntryLocation = matchedDescriptionForThisEntry[1];
                    
                    const highlightedDescriptionText = configDoc.getText(matchedDescriptionForThisEntryLocation.range);
                    let startOff: number;
                    let textSubset = matchedDescriptionForThisEntryFullString;
                    let lastSliceIndex: number = 0;
                    while ((startOff = textSubset.indexOf(highlightedDescriptionText)) !== -1) {
                        if (cancellationToken.isCancellationRequested) return null;
                        const nextSliceIndex = startOff + highlightedDescriptionText.length + lastSliceIndex;
                        highlightsDescription.push([ startOff + lastSliceIndex, nextSliceIndex ]);
                        textSubset = matchedDescriptionForThisEntryFullString.substring(nextSliceIndex);
                        lastSliceIndex = nextSliceIndex;
                    }
                }


                // Get the node that the entry in the .config file refers to
                const entryUri = vscode.Uri.joinPath(parent.node.uri, entryFileName);
                const node = await vagueNodeSearch(entryUri);
                if (node.source === null || node.node === null) continue;
                if (cancellationToken.isCancellationRequested) return null;

                // Format the title for the node
                const linkNode: Exclude<VagueNodeSearchResult, { node: null, source: null }> = node;
                const [ prefix, title ] = linkNode.source === 'notebook' 
                    ? [ `Note`, linkNode.node.title ]
                    : [ `${capitalize(linkNode.node.data.ids.type)}`, linkNode.node.data.ids.display ];

                let ordering: number = 0;
                if (node.node instanceof OutlineNode) {
                    ordering = node.node.data.ids.ordering;
                }

                // Create a matched title node search node to represent this title match
                const matcheMetadataNode = new SearchNode<MatchedMetadataNode>({
                    kind: 'matchedMetadata',
                    prefix: prefix,
                    title: title,
                    linkNode: linkNode,
                    parentLabels: parentLabels,
                    parentUri: parent.node.uri,
                    labelHighlights: highlightsTitle,
                    description: configEntry.description,
                    descriptionHighlights: highlightsDescription,
                    uri: entryUri,
                    ordering: ordering
                });

                // If the node that the .config entry refers to already exists in the node tree for the search results,
                //      then we add this node as the `pairedMatchedMetadataNode`
                // This is to let the original container / leaf node exist in the tree where it originally was, while allowing 
                //      the matched text to be highlighted in that tree -- otherwise there would be one tree node for the 
                //      original match (either because the child has a match inside of it, or because it is a fragment that also
                //      contains the searched text) and one node for the title match
                if (parent.node.contents[entryFileName] && (parent.node.contents[entryFileName].node.kind === 'file' || parent.node.contents[entryFileName].node.kind === 'searchContainer')) {
                    (parent.node.contents[entryFileName].node as SearchContainerNode | FileResultNode).pairedMatchedMetadataNode = matcheMetadataNode;
                }
                // Otherwise, just create a new entry under the parent container with this matched title
                else {
                    parent.node.contents[Math.random() + ""] = matcheMetadataNode;
                }
            
            }
        }
        return this.cleanNodeTree();
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
    async insertResult (
        location: vscode.Location,
        createTitleNodes: boolean,
        createNodeDescriptionNodes: boolean,
        cancellationToken: vscode.CancellationToken
    ): Promise<SearchNode<SearchContainerNode>[] | null> {

        // All search locations besides 'notebook' use a UriBasedView with an OutlineNode as the Node
        //      so for all three of these we can use the same function to extract labels

        const path = getRelativePath(location.uri);
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

        const isDotConfig = location.uri.fsPath.endsWith('.config');
        const isNotebook = location.uri.fsPath.toLowerCase().endsWith('.wtnote');
        if (isDotConfig || isNotebook) {
            if (isDotConfig && !(createTitleNodes || createNodeDescriptionNodes)) {
                return this.cleanNodeTree();
            }
            
            const configDoc = await vscode.workspace.openTextDocument(location.uri);
            if (cancellationToken.isCancellationRequested) return null;

            const jsonContext = getJSONStringContext(configDoc, configDoc.getText(), location);
            if (jsonContext === null) {
                return this.cleanNodeTree();
            }

            // Depending on the context of the search result within the JSON, determine if this is a valid search result
            const [ surroundingInfo, context ] = jsonContext;
            if (context.kind !== 'keyValue') {
                // If the searched string is not the 'value' of a JSON object member, then ignore it
                return this.cleanNodeTree();
            }
            else {
                // All .wtnote files store Cell values inside an string with key 'text'
                // Since we are only searching on the values of cells within a notebook, then we can ignore
                //      all other key-value pairs
                if (isNotebook) {
                    if (context.keyName !== 'text') {
                        return this.cleanNodeTree();
                    }
                }
                // The only thing of value for search results inside of a .config file is the title of the 
                //      .config entry, we can ignore everything else
                else if (isDotConfig) {
                    if (context.keyName !== 'title' && context.keyName !== 'description') {
                        return this.cleanNodeTree();
                    }
                }
            }

            // For .config search results, we don't need to add a node to the tree just yet
            // All title matches are resolve later, once the full search on .wt and .wtnote has
            //      completed
            // So, for now, we just store a record of the .config files and their location that
            //      we encounter, to be used later when createTitleNodes is called 
            if (isDotConfig) {
                const formattedUri = formatFsPathForCompare(location.uri);

                // If this is the first match for this .config file, create a new empty set of config data
                if (!(formattedUri in this.configNodes)) {
                    this.configNodes[formattedUri] = {
                        uri: location.uri,
                        doc: configDoc,
                        
                        // Empty for now, to be filled in later
                        titleLocationStringInfo: [],
                        descriptionLocationStringInfo: [],
    
                        // Temporary data -- to be updated later
                        // Since .config files still have enclosing folders and parents, we need to calculate data for all
                        //      parents of the .config, and then reset these fields once we arrive at the leaf
                        parent: parentNode,
                        parentLabels: parentLabels,
                    };
                }

                // Add data to the existing match
                if (context.keyName === 'title' && createTitleNodes) {
                    this.configNodes[formattedUri].titleLocationStringInfo.push([ surroundingInfo, location ]);
                }
                else if (context.keyName === 'description' && createNodeDescriptionNodes) {
                    this.configNodes[formattedUri].descriptionLocationStringInfo.push([ surroundingInfo, location ]);
                }

            }
        }

        // Iterate each segment of the path of the added location
        for (let index = 0; index < pathSegments.length; index++) {

            const segment = pathSegments[index];
            relativePath.push(segment);

            const uri = vscode.Uri.joinPath(Extension.rootPath, ...relativePath);
            const isLeaf = index === pathSegments.length - 1;

            const config = await configProviders[category](uri);
            if (!config) {
                // After traversing a bunch of parent nodes to get to the leaf .config file,
                //      only then are `parentNode` and `parentLabels` valid (as in, only then)
                //      do they point to the correct parent data
                // Need to reset current data inside of configNodes[formattedFsPath]
                if (isLeaf && isDotConfig && (createTitleNodes || createNodeDescriptionNodes)) {
                    const formattedPath = formatFsPathForCompare(uri);
                    this.configNodes[formattedPath].parent = parentNode;
                    this.configNodes[formattedPath].parentLabels = parentLabels;
                }
                continue;
            }

            const { prefix, title, description, ordering } = config;

            // If we have encountered this path segment before and added it to the node tree:
            if (parentNode.node.contents[segment]) {
                
                // If the node is a leaf (a file, rather than another directory):
                if (isLeaf) {
                    // Add this new location to the existing node for this file
                    if (parentNode.node.contents[segment].node.kind !== 'file') {
                        throw 'Must be a search file node';
                    }
                    
                    const leafNode = parentNode.node.contents[segment] as SearchNode<FileResultNode>;
                    leafNode.node.locations.push(await this.createLocationNode(uri, location, parentLabels, title, prefix));
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
                    parentNode.node.contents[segment] = new SearchNode<FileResultNode>({
                        kind: 'file',
                        ext: vscodeUri.Utils.extname(uri),
                        prefix: prefix,
                        title: title,
                        parentLabels: parentLabels,
                        description: description,
                        locations: [await this.createLocationNode(uri, location, parentLabels, title, prefix)],
                        uri: uri,
                        parentUri: parentUri,
                        ordering: ordering
                    });
                }
                else {
                    if (cancellationToken.isCancellationRequested) return null;
                    
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
                        ordering: ordering
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