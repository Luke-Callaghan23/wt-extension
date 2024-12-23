import * as vscode from 'vscode';
import { FileResultLocationNode, FileResultNode, SearchContainerNode, SearchNode } from '../searchResultsNode';
import { FileSystemFormat, ResultFolder } from './createFileSystemTree';
import * as extension from './../../extension';
import * as vscodeUri from 'vscode-uri';
import { UriBasedView } from '../../outlineProvider/UriBasedView';
import { OutlineNode } from '../../outline/nodes_impl/outlineNode';
import { capitalize } from '../../intellisense/common';


type LabelProvider = (uri: vscode.Uri) => Promise<string | null>;

const getResultsCount = (childContents: SearchNode<SearchContainerNode | FileResultNode>[]): number => {
    return childContents.reduce((acc, element) => {
        if (element.node.kind === 'file') {
            return acc + element.node.locations.length;
        }
        else if (element.node.kind === 'searchContainer') {
            return acc + element.node.results;
        }
        return acc;
    }, 0);
}

async function convertFolderToSearchNode (parent: SearchNode<SearchContainerNode | FileResultNode>[], parentLabels: string[], parentUri: vscode.Uri, folder: ResultFolder, labelProvider: LabelProvider) {
    for (const [ fileName, folderOrFile ] of Object.entries(folder.contents)) {
        const uri = vscode.Uri.joinPath(parentUri, fileName);
        const label = await labelProvider(uri);
        if (!label) continue;
        if (folderOrFile.kind === 'file') {
            // For file nodes, create `FileResultLocationNode` for all the child locations for this file
            parent.push(new SearchNode<FileResultNode>({
                kind: 'file',
                ext: folderOrFile.ext,
                label: label,
                parentLabels: parentLabels,
                locations: folderOrFile.locations.map(location => new SearchNode<FileResultLocationNode>({
                    kind: 'fileLocation',
                    location: location.location,
                    parentUri: uri,
                    parentLabels: [ ...parentLabels, label ],
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
            await convertFolderToSearchNode(childContents, [...parentLabels, label], uri, folderOrFile, labelProvider);
            
            const results = getResultsCount(childContents);
            parent.push(new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                contents: childContents,
                label: label,
                parentLabels: parentLabels,
                uri: uri,
                parentUri: parentUri,
                results: results,
            }));
        }
    }
}

type Categories = 'chapters' | 'snips' | 'scratchPad' | 'recycle' | 'workBible';
export async function recreateNodeTree (fileSystemGitGrep: FileSystemFormat): Promise<Record<Categories, SearchNode<SearchContainerNode>> | null> {

    const rootCategoryNodes: Record<Categories, SearchNode<SearchContainerNode>> = {
        'chapters': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'chapters'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            label: 'Chapters'
        }),
        'snips': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'snips'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            label: 'Work Snips'
        }),
        'scratchPad': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'scratchPad'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            label: 'Scratch Pad'
        }),
        'recycle': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'recycling'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            label: 'Recycling Bin'
        }),
        'workBible': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'workBible'),
            contents: [],
            results: 0,
            parentLabels: [],
            parentUri: null,
            label: 'Work Notes'
        }),
    };

    // All search locations besides 'workBible' use a UriBasedView with an OutlineNode as the Node
    //      so for all three of these we can use the same function to extract labels
    const mainLabelProvider = (view: UriBasedView<OutlineNode>) => async (uri: vscode.Uri) => {
        const node = await view.getTreeElementByUri(uri);
        if (!node) return null;
        return node.data.ids.type !== 'container'
            ? `(${capitalize(node.data.ids.type)}) ${node.data.ids.display}`
            : "Chapter Snips Container";
    }

    const labelProviders: Record<Categories, LabelProvider> = {
        'chapters': mainLabelProvider(extension.ExtensionGlobals.outlineView),
        'snips': mainLabelProvider(extension.ExtensionGlobals.outlineView),
        'scratchPad': mainLabelProvider(extension.ExtensionGlobals.scratchPadView),
        'recycle': mainLabelProvider(extension.ExtensionGlobals.recyclingBinView),
        // For the work bible, since OutlineNodes are not used, we can just take the "noun" in the note as the label
        'workBible': async (uri: vscode.Uri) => {
            const note = extension.ExtensionGlobals.workBible.getNote(uri);
            if (!note) return null;
            return `(Note) ${note.noun}`;
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
        await convertFolderToSearchNode(rootContainer.node.contents, [ rootContainer.node.label ], rootContainer.node.uri, categoryRootFolder, labelProvider);

        rootContainer.node.results = getResultsCount(rootContainer.node.contents);
    }

    return rootCategoryNodes;
}

// Filter tree rules:
//      If there is a folder node with only one child, replace the folder with that child
//      Add the removed folder's name to the child's description
//      Recurse until the child is a 'file' node
// Filter tree is always called with a Folder node as the argument
function filterTree (node: SearchNode<SearchContainerNode>, root: boolean, description?: string[]): SearchNode<SearchContainerNode | FileResultNode> {
    const createDescription = (includeOwn: boolean=false) => {
        description = description || [];
        if (includeOwn) {
            description.push(node.node.label);
        }
        return description.join(' > ');
    }
    
    if (node.node.contents.length === 1 && !root) {

        const nextup = node.node.contents[0];
        if (nextup.node.kind === 'file') {

            // Push the label of this folder node into the description of the child, and return the file child
            nextup.description = createDescription(true);
            return nextup;
        }

        // Push the label of this folder into the description of the child, and recurse
        const nextDescription = description 
            ? [ ...description, node.node.label ]
            : [ node.node.label ];
        return filterTree(nextup as SearchNode<SearchContainerNode>, false, nextDescription);
    }

    // Iterate over folder node's contents
    node.description = createDescription();
    node.node.contents = node.node.contents.map(childNode => {
        if (childNode.node.kind === 'file') {
            return childNode;
        }
        // Recursively filter all the folder children of this node
        return filterTree(childNode as SearchNode<SearchContainerNode>, false, description);
    });
    return node;
}

export function cleanNodeTree (trees: Record<Categories, SearchNode<SearchContainerNode>>): SearchNode<SearchContainerNode | FileResultNode>[] {
    const cleanedTrees: SearchNode<SearchContainerNode | FileResultNode>[] = [];
    for (const searchTree of Object.values(trees)) {
        // If the root node does not have any children, we do not want to keep that category in the 
        //      search results view, so entirely skip over it
        if (searchTree.node.results === 0) continue;
        cleanedTrees.push(filterTree(searchTree, true));
    }
    return cleanedTrees;
}