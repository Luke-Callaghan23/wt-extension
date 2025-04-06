import * as vscode from 'vscode';
import { FileResultLocationNode, FileResultNode, MatchedTitleNode, SearchContainerNode, SearchNode } from '../searchResultsNode';
import { FileSystemFormat, ResultFile, ResultFolder } from './createFileSystemTree';
import * as extension from './../../extension';
import * as vscodeUri from 'vscode-uri';
import { UriBasedView } from '../../outlineProvider/UriBasedView';
import { OutlineNode } from '../../outline/nodes_impl/outlineNode';
import { capitalize } from '../../intellisense/common';
import { formatFsPathForCompare, readDotConfig, vagueNodeSearch, VagueNodeSearchResult } from '../../miscTools/help';


type LabelProvider = (uri: vscode.Uri) => Promise<[ string, string ] | null>;

const getResultsCount = (childContents: SearchNode<SearchContainerNode | FileResultNode | MatchedTitleNode>[]): number => {
    return childContents.reduce((acc, element) => {
        if (element.node.kind === 'file') {
            return acc + element.node.locations.length;
        }
        else if (element.node.kind === 'searchContainer') {
            return acc + element.node.results;
        }
        else if (element.node.kind === 'matchedTitle') {
            return acc + 1;
        }
        return acc;
    }, 0);
}

export const createLabelFromTitleAndPrefix = (title: string, prefix: string) => {
    if (prefix.length === 0) return title;
    return `(${prefix}) ${title}`;
}

const getFullJSONStringFromLocation = (document: vscode.TextDocument, fullText: string, location: vscode.Location): string => {
    const startOff = document.offsetAt(location.range.start);
    const endOff = document.offsetAt(location.range.end);

    let stringStartOff;
    for (stringStartOff = startOff - 1; stringStartOff >= 0; stringStartOff--) {
        if (fullText[stringStartOff] === '"' && fullText[stringStartOff - 1] !== '\\') {
            stringStartOff++;
            break;
        }
    }

    let stringEndOff;
    for (stringEndOff = endOff; stringEndOff < fullText.length; stringEndOff++) {
        if (fullText[stringEndOff] === '"' && fullText[stringEndOff - 1] !== '\\') {
            break;
        }
    }

    return document.getText(new vscode.Range(document.positionAt(stringStartOff), document.positionAt(stringEndOff))).replaceAll('\\"', '"');
}

async function convertFolderToSearchNode (
    parent: SearchNode<SearchContainerNode | FileResultNode | MatchedTitleNode>[], 
    parentLabels: string[], parentUri: vscode.Uri, 
    folder: ResultFolder, 
    labelProvider: LabelProvider,
    createTitleNodes: boolean,
) {
    for (const [ fileName, folderOrFile ] of Object.entries(folder.contents)) {
        const uri = vscode.Uri.joinPath(parentUri, fileName);
        const label = await labelProvider(uri);
        if (!label) {
            if (!createTitleNodes || fileName !== '.config') continue;

            // If the label is null but the file a .config file and we are creating title nodes, then try to create a title
            //      node for this entry in config file
            const dotConfig = await readDotConfig(uri);
            if (!dotConfig) continue;
            const configFileNode = folderOrFile as ResultFile;

            const configDoc = await vscode.workspace.openTextDocument(uri);
            const configFullText = configDoc.getText();

            const createdEntriesFileNames: string[] = [];
            for (const location of configFileNode.locations) {
                const fullTitleString = getFullJSONStringFromLocation(configDoc, configFullText, location.location);
                for (const [ entryFileName, configEntry ] of Object.entries(dotConfig)) {
                    // If the entry title is not the same as the full title string we retrieved above, then skip over it
                    if (configEntry.title !== fullTitleString) continue;

                    const highlightedText = configDoc.getText(location.location.range);
                    const highlights: [number, number][] = [];
                    let textSubset = fullTitleString;;
                    let startOff: number;
                    let lastSliceIndex: number = 0;
                    while ((startOff = textSubset.indexOf(highlightedText)) !== -1) {
                        const nextSliceIndex = startOff + highlightedText.length + lastSliceIndex;
                        highlights.push([ startOff + lastSliceIndex, nextSliceIndex ]);
                        textSubset = fullTitleString.substring(nextSliceIndex);
                        lastSliceIndex = nextSliceIndex;
                    }

                    // If an entry was already made for this file name, then skip over it
                    if (createdEntriesFileNames.find(cefn => cefn === entryFileName)) continue;

                    const entryUri = vscode.Uri.joinPath(parentUri, entryFileName);
                    const node = await vagueNodeSearch(entryUri);
                    if (node.source === null || node.node === null) continue;

                    const linkNode: Exclude<VagueNodeSearchResult, { node: null, source: null }> = node;
                    const [ prefix, title ] = linkNode.source === 'notebook' 
                        ? [ `Note`, linkNode.node.noun ]
                        : [ `${capitalize(linkNode.node.data.ids.type)}`, linkNode.node.data.ids.display ];

                    parent.push(new SearchNode<MatchedTitleNode>({
                        kind: 'matchedTitle',
                        prefix: prefix,
                        title: title,
                        linkNode: linkNode,
                        parentLabels: parentLabels,
                        parentUri: parentUri,
                        labelHighlights: highlights,
                        uri: entryUri,
                    }));
                    createdEntriesFileNames.push(entryFileName);
                }
            }
            continue;
        }
        
        const [ prefix, title ] = label;
        if (folderOrFile.kind === 'file') {
            // For file nodes, create `FileResultLocationNode` for all the child locations for this file
            parent.push(new SearchNode<FileResultNode>({
                kind: 'file',
                ext: folderOrFile.ext,
                prefix: prefix,
                title: title,
                parentLabels: parentLabels,
                locations: folderOrFile.locations.map(location => new SearchNode<FileResultLocationNode>({
                    kind: 'fileLocation',
                    location: location.location,
                    parentUri: uri,
                    parentLabels: [ ...parentLabels, createLabelFromTitleAndPrefix(title, prefix) ],
                    surroundingText: location.surroundingText,
                    largerSurroundingText: location.largerSurrounding,
                    largerSurroundingTextHighlight: location.largerSurroundingHighlight,
                    surroundingTextHighlight: location.surroundingTextHighlight,
                    uri: vscodeUri.URI.from({
                        ...uri,
                        fragment: `#L${location.location.range.start.line},${location.location.range.start.character}-${location.location.range.end.line},${location.location.range.end.character}`
                    })
                })),
                uri: uri,
                parentUri: parentUri,
            }));
        }
        else if (folderOrFile.kind === 'folder') {
            // For folder nodes, recurse into all child items and create `SearchNode`s for them
            const childContents: SearchNode<SearchContainerNode | FileResultNode>[] = [];
            await convertFolderToSearchNode(childContents, [...parentLabels, createLabelFromTitleAndPrefix(title, prefix)], uri, folderOrFile, labelProvider, createTitleNodes);
            
            const results = getResultsCount(childContents);
            parent.push(new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                contents: childContents,
                prefix: prefix,
                title: title,
                parentLabels: parentLabels,
                uri: uri,
                parentUri: parentUri,
                results: results,
            }));
        }
    }
}

type Categories = 'chapters' | 'snips' | 'scratchPad' | 'recycle' | 'notebook';
export async function recreateNodeTree (fileSystemGitGrep: FileSystemFormat, createTitleNodes: boolean): Promise<Record<Categories, SearchNode<SearchContainerNode>> | null> {

    const rootCategoryNodes: Record<Categories, SearchNode<SearchContainerNode>> = {
        'chapters': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'chapters'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            title: 'Chapters',
            prefix: '',
        }),
        'snips': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'snips'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            title: 'Work Snips',
            prefix: '',
        }),
        'scratchPad': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'scratchPad'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            title: 'Scratch Pad',
            prefix: '',
        }),
        'recycle': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'recycling'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            title: 'Recycling Bin',
            prefix: '',
        }),
        'notebook': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'notebook'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            title: 'Work Notebook',
            prefix: '',
        }),
    };

    // All search locations besides 'notebook' use a UriBasedView with an OutlineNode as the Node
    //      so for all three of these we can use the same function to extract labels
    const mainLabelProvider = (view: UriBasedView<OutlineNode>) => async (uri: vscode.Uri): Promise<[ string, string ] | null> => {
        const node = await view.getTreeElementByUri(uri);
        if (!node) return null;
        return node.data.ids.type !== 'container'
            ? [ capitalize(node.data.ids.type), `${node.data.ids.display}` ]
            : [ '', "Chapter Snips Container" ];
    }

    const labelProviders: Record<Categories, LabelProvider> = {
        'chapters': mainLabelProvider(extension.ExtensionGlobals.outlineView),
        'snips': mainLabelProvider(extension.ExtensionGlobals.outlineView),
        'scratchPad': mainLabelProvider(extension.ExtensionGlobals.scratchPadView),
        'recycle': mainLabelProvider(extension.ExtensionGlobals.recyclingBinView),
        // For the notebook, since OutlineNodes are not used, we can just take the "noun" in the note as the label
        'notebook': async (uri: vscode.Uri) => {
            const note = extension.ExtensionGlobals.notebook.getNote(uri);
            if (!note) return null;
            return [ 'Note', note.noun ];
        }
    };

    // If the main 'data' folder is not in the node results then return all empty categories for all the roots
    if (!('' in fileSystemGitGrep.folders.contents && 'data' in (fileSystemGitGrep.folders.contents[''] as ResultFolder).contents)) {
        return rootCategoryNodes;
    }

    const dataFolder = (fileSystemGitGrep.folders.contents[''] as ResultFolder).contents['data'] as ResultFolder;
    for (const c of Object.keys(rootCategoryNodes)) {
        const category: Categories = c as Categories;

        const categoryRootFolder = (dataFolder.contents[category] as ResultFolder);
        if (!categoryRootFolder) continue;

        const rootContainer = rootCategoryNodes[category];
        const labelProvider = labelProviders[category];
        await convertFolderToSearchNode(rootContainer.node.contents, [ rootContainer.node.title ], rootContainer.node.uri, categoryRootFolder, labelProvider, createTitleNodes);

        rootContainer.node.results = getResultsCount(rootContainer.node.contents);
    }

    return rootCategoryNodes;
}

// Filter tree rules:
//      If there is a folder node with only one child, replace the folder with that child
//      Add the removed folder's name to the child's description
//      Recurse until the child is a 'file' node
// Filter tree is always called with a Folder node as the argument
function filterTree (node: SearchNode<SearchContainerNode>, root: boolean, description?: string[]): SearchNode<SearchContainerNode | FileResultNode | MatchedTitleNode> {
    const createDescription = (includeOwn: boolean=false) => {
        description = description || [];
        if (includeOwn) {
            description.push(createLabelFromTitleAndPrefix(node.node.title, node.node.prefix));
        }
        return description.join(' > ');
    }
    
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
        return filterTree(nextup as SearchNode<SearchContainerNode>, false, nextDescription);
    }

    // Iterate over folder node's contents
    node.description = createDescription();
    node.node.contents = node.node.contents.map(childNode => {
        if (childNode.node.kind === 'file' || childNode.node.kind === 'matchedTitle') {
            return childNode;
        }
        else if (childNode.node.kind === 'searchContainer') {
            // Recursively filter all the folder children of this node
            return filterTree(childNode as SearchNode<SearchContainerNode>, false, description);
        }
        // @ts-ignore
        else throw `filter tree unexpected child node kind '${childNode.node.kind}'`;
    });
    return node;
}

export function cleanNodeTree (trees: Record<Categories, SearchNode<SearchContainerNode>>): SearchNode<SearchContainerNode>[] {
    const cleanedTrees: SearchNode<SearchContainerNode>[] = [];
    for (const searchTree of Object.values(trees)) {
        // If the root node does not have any children, we do not want to keep that category in the 
        //      search results view, so entirely skip over it
        if (searchTree.node.results === 0) continue;

        // We know that the root level result will always be a search container node, so it is okay to cast it as such
        cleanedTrees.push(searchTree);
    }
    return cleanedTrees;
}


function pairContainer (containerNode: SearchNode<SearchContainerNode>) {
    type ChildNode = {
        node: SearchNode<SearchContainerNode | FileResultNode | MatchedTitleNode>,
        parentContentIndex: number,
    };
    const uriMap: Record<string, ChildNode[]> = {};
    for (let index = 0; index < containerNode.node.contents.length; index++) {
        const child = containerNode.node.contents[index];
        const cmpUri = formatFsPathForCompare(child.getUri());
        if (uriMap[cmpUri]) {
            uriMap[cmpUri].push({
                node: child,
                parentContentIndex: index,
            });
        }
        else {
            uriMap[cmpUri] = [ {
                node: child,
                parentContentIndex: index,
            } ];
        }

        if (child.node.kind === 'searchContainer') {
            pairContainer(child as SearchNode<SearchContainerNode>);
        }
    }

    const removeIndexes: number[] = [];
    for (const [ uri, pairs ] of Object.entries(uriMap)) {
        if (pairs.length === 1) continue;
        if (pairs.length !== 2) throw `Unexpected pair count for '${uri}'`;

        const [ nodeOne, nodeTwo ] = pairs;
        let matchedTitleNode: SearchNode<MatchedTitleNode>;
        let otherNode: SearchNode<SearchContainerNode | FileResultNode | MatchedTitleNode>;
        let matchedTitleIndex: number;
        if (nodeOne.node.node.kind === 'matchedTitle') {
            matchedTitleNode = nodeOne.node as SearchNode<MatchedTitleNode>;
            matchedTitleIndex = nodeOne.parentContentIndex;
            otherNode = nodeTwo.node;
        }
        else if (nodeTwo.node.node.kind === 'matchedTitle') {
            matchedTitleNode = nodeTwo.node as SearchNode<MatchedTitleNode>;
            matchedTitleIndex = nodeTwo.parentContentIndex;
            otherNode = nodeOne.node;
        }
        else throw `Unexpected two nodes for ${uri} but neither are matched title nodes`;

        if (otherNode.node.kind === 'matchedTitle') throw `Unexpected two matched title nodes for same uri: ${uri}`

        // Once the pairing has been established, insert the matched title node into the data of its pair
        otherNode.node.pairedMatchedTitleNode = matchedTitleNode;

        // And store the index for removal
        removeIndexes.push(matchedTitleIndex);
    }

    removeIndexes.sort((a, b) => b - a);
    for (const remove of removeIndexes) {
        containerNode.node.contents.splice(remove, 1);
    }
}

export function pairMatchedTitlesToNeighborNodes (filteredTree: SearchNode<SearchContainerNode>[]): SearchNode<SearchContainerNode>[] {
    return filteredTree.map(tree => {
        pairContainer(tree);
        return tree;
    })
}
