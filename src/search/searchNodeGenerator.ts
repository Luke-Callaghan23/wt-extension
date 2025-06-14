import * as vscode from 'vscode';
import { capitalize, formatFsPathForCompare, getFullJSONStringFromLocation, getRelativePath, getSurroundingTextInRange, readDotConfig, UriFsPathFormatted, vagueNodeSearch, VagueNodeSearchResult, VagueSearchSource } from '../miscTools/help';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import * as extension from '../extension';
import * as vscodeUri from 'vscode-uri';
import { Buff } from '../Buffer/bufferSource';
import { FileResultLocationNode, FileResultNode, MatchedTitleNode, SearchContainerNode, SearchNode } from './searchResultsNode';
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
type LabelProvider = (uri: vscode.Uri) => Promise<[ string, string ] | null>;

export class CreateSearchResults {
    
    private docMap: Record<string, vscode.TextDocument>;
    private rootCategoryNodes: Record<Categories, SearchNode<SearchContainerNode>>;
    private configNodes: Record<UriFsPathFormatted, {
        uri: vscode.Uri,
        parent: SearchNode<SearchContainerNode>,
        parentLabels: string[],
        locations: vscode.Location[],
    }>;

    constructor () {
        this.configNodes = {};
        this.rootCategoryNodes = {
            'chapters': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'chapters'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(extension.rootPath, 'data'),
                title: 'Chapters',
                prefix: '',
            }),
            'snips': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'snips'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(extension.rootPath, 'data'),
                title: 'Work Snips',
                prefix: '',
            }),
            'scratchPad': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'scratchPad'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(extension.rootPath, 'data'),
                title: 'Scratch Pad',
                prefix: '',
            }),
            'recycle': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'recycling'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(extension.rootPath, 'data'),
                title: 'Recycling Bin',
                prefix: '',
            }),
            'notebook': new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'notebook'),
                contents: {},
                results: 0,
                parentLabels: [],
                parentUri: vscode.Uri.joinPath(extension.rootPath, 'data'),
                title: 'Work Notebook',
                prefix: '',
            }),
        };
        this.docMap = {};
    }

    private getLabelProviders (): Record<Categories, LabelProvider> {

        const mainLabelProvider = (view: UriBasedView<OutlineNode>) => {
            return async (uri: vscode.Uri): Promise<[ string, string ] | null> => {
                const node = await view.getTreeElementByUri(uri);
                if (!node) return null;

                
                if (node.data.ids.type !== 'container') {
                    return [ capitalize(node.data.ids.type), `${node.data.ids.display}` ]
                }
                else {
                    return [ '', "Chapter Snips Container" ];
                }
            };
        };

        return {
            'chapters': mainLabelProvider(extension.ExtensionGlobals.outlineView),
            'snips': mainLabelProvider(extension.ExtensionGlobals.outlineView),
            'scratchPad': mainLabelProvider(extension.ExtensionGlobals.scratchPadView),
            'recycle': mainLabelProvider(extension.ExtensionGlobals.recyclingBinView),
            // For the notebook, since OutlineNodes are not used, we can just take the "title" in the note as the label
            'notebook': async (uri: vscode.Uri) => {
                const note = extension.ExtensionGlobals.notebookPanel.getNote(uri);
                if (!note) return null;
                return [ 'Note', note.title ];
            }
        }
    }

    private getResultsCount (node: SearchNode<SearchContainerNode | FileResultNode | MatchedTitleNode>): number {
        if (node.node.kind === 'file') {
            return node.node.locations.length;
        }
        else if (node.node.kind === 'matchedTitle') {
            return 1;
        }
        else if (node.node.kind === 'searchContainer') {
            node.node.results = Object.values(node.node.contents).reduce((acc, element) => acc + this.getResultsCount(element), 0);
            return node.node.results;
        }
        else throw 'Unreachable';
    }


    public async createTitleNodes (
        cancellationToken: vscode.CancellationToken
    ): Promise<SearchNode<SearchContainerNode>[] | null> {
        for (const [ _, { uri, parent, locations, parentLabels } ] of Object.entries(this.configNodes)) {
            
            // If the label is null but the file a .config file and we are creating title nodes, then try to create a title
            //      node for this entry in config file
            const dotConfig = await readDotConfig(uri);
            if (!dotConfig || cancellationToken.isCancellationRequested) return null;
    
            const configDoc = await vscode.workspace.openTextDocument(uri);
            if (cancellationToken.isCancellationRequested) return null;
            
            const configFullText = configDoc.getText();
            const createdEntriesFileNames: Set<string> = new Set<string>();
            for (const location of locations) {
                if (cancellationToken.isCancellationRequested) return null;
    
                const {jsonString: fullTitleString} = getFullJSONStringFromLocation(configDoc, configFullText, location);
                for (const [ entryFileName, configEntry ] of Object.entries(dotConfig)) {
                    // If the entry title is not the same as the full title string we retrieved above, then skip over it
                    if (configEntry.title !== fullTitleString) continue;
                    if (cancellationToken.isCancellationRequested) return null;
    
                    const highlightedText = configDoc.getText(location.range);
                    const highlights: [number, number][] = [];
                    let textSubset = fullTitleString;
                    let startOff: number;
                    let lastSliceIndex: number = 0;
                    while ((startOff = textSubset.indexOf(highlightedText)) !== -1) {
                        if (cancellationToken.isCancellationRequested) return null;
                        const nextSliceIndex = startOff + highlightedText.length + lastSliceIndex;
                        highlights.push([ startOff + lastSliceIndex, nextSliceIndex ]);
                        textSubset = fullTitleString.substring(nextSliceIndex);
                        lastSliceIndex = nextSliceIndex;
                    }
    
                    // If an entry was already made for this file name, then skip over it
                    if (createdEntriesFileNames.has(entryFileName)) continue;
                    if (cancellationToken.isCancellationRequested) return null;
    
                    // 
                    const entryUri = vscode.Uri.joinPath(parent.node.uri, entryFileName);
                    const node = await vagueNodeSearch(entryUri);
                    if (node.source === null || node.node === null) continue;
                    if (cancellationToken.isCancellationRequested) return null;
    
                    const linkNode: Exclude<VagueNodeSearchResult, { node: null, source: null }> = node;
                    const [ prefix, title ] = linkNode.source === 'notebook' 
                        ? [ `Note`, linkNode.node.title ]
                        : [ `${capitalize(linkNode.node.data.ids.type)}`, linkNode.node.data.ids.display ];
    
                    const matchedTitleNode = new SearchNode<MatchedTitleNode>({
                        kind: 'matchedTitle',
                        prefix: prefix,
                        title: title,
                        linkNode: linkNode,
                        parentLabels: parentLabels,
                        parentUri: parent.node.uri,
                        labelHighlights: highlights,
                        uri: entryUri,
                    });

                    if (parent.node.contents[entryFileName] && (parent.node.contents[entryFileName].node.kind === 'file' || parent.node.contents[entryFileName].node.kind === 'searchContainer')) {
                        parent.node.contents[entryFileName].node.pairedMatchedTitleNode = matchedTitleNode;
                    }
                    else {
                        parent.node.contents[Math.random() + ""] = matchedTitleNode;
                    }

                    createdEntriesFileNames.add(entryFileName);
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
    private filterTree (node: SearchNode<SearchContainerNode>, root: boolean, description?: string[]): SearchNode<SearchContainerNode | FileResultNode | MatchedTitleNode> {
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
            if (childNode.node.kind === 'file' || childNode.node.kind === 'matchedTitle') {
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
            // If the root node does not have any children, we do not want to keep that category in the 
            //      search results view, so entirely skip over it
            this.getResultsCount(searchTree);
            if (searchTree.node.results === 0) continue;

            // We know that the root level result will always be a search container node, so it is okay to cast it as such
            cleanedTrees.push(searchTree);
        }
        return cleanedTrees;
    }

    async insertResult (
        location: vscode.Location,
        createTitleNodes: boolean,
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
        const labelProviders = this.getLabelProviders();
        
        let parentLabels: string[] = [];
        let parentNode: SearchNode<SearchContainerNode> = this.rootCategoryNodes[category];
        let parentUri: vscode.Uri = parentNode.node.uri;

        for (let index = 0; index < pathSegments.length; index++) {
            const segment = pathSegments[index];
            relativePath.push(segment);

            const uri = vscode.Uri.joinPath(extension.rootPath, ...relativePath);
            const isLeaf = index === pathSegments.length - 1;

            const label = await labelProviders[category](uri);
            if (!label) {
                if (segment === '.config' && createTitleNodes) {
                    const formattedUri = formatFsPathForCompare(uri);
                    if (formattedUri in this.configNodes) {
                        this.configNodes[formattedUri].locations.push(location);
                    }
                    else {
                        this.configNodes[formattedUri] = {
                            uri: uri,
                            parent: parentNode,
                            parentLabels: parentLabels,
                            locations: [ location ]
                        };
                    }
                }
                continue;
            }

            const [ prefix, title ] = label;

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
                        locations: [await this.createLocationNode(uri, location, parentLabels, title, prefix)],
                        uri: uri,
                        parentUri: parentUri,
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
                        uri: uri,
                        parentUri: parentUri,
                        results: 0,
                    });
                    parentLabels.push(createLabelFromTitleAndPrefix(title, prefix));

                    parentNode.node.contents[segment] = next;
                    parentNode = next;
                }
            }
        }

        return this.cleanNodeTree();
    }
}