import * as vscode from 'vscode';
import { capitalize, ConfigFileInfo, formatFsPathForCompare, getFullJSONStringFromLocation, getJSONContext, getRelativePath, getSurroundingTextInRange, JSONStringInfo, readDotConfig, UriFsPathFormatted, vagueNodeSearch, VagueNodeSearchResult, VagueSearchSource } from '../miscTools/help';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { Extension } from   '../extension';
import * as vscodeUri from 'vscode-uri';
import { Buff } from '../Buffer/bufferSource';
import { FileResultLocationNode, FileResultNode, MatchedMetadataNode, SearchContainerNode, SearchNode } from './searchResultsNode';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { SearchNodeKind } from './searchResultsView';
import { assert } from 'console';
import { ResultInfo } from './searchResultsTree';



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
    async insertResult (
        result: ResultInfo,
        cancellationToken: vscode.CancellationToken
    ): Promise<SearchNode<SearchContainerNode>[] | null> {

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