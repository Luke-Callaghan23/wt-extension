import * as vscode from 'vscode';
import { FileResultLocationNode, FileResultNode, SearchContainerNode, SearchNode } from '../searchResultsNode';
import { FileSystemFormat, ResultFolder } from './createFileSystemTree';
import * as extension from './../../extension';
import * as vscodeUri from 'vscode-uri';
import { UriBasedView } from '../../outlineProvider/UriBasedView';
import { OutlineNode } from '../../outline/nodes_impl/outlineNode';


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

async function processFolder (parent: SearchNode<SearchContainerNode | FileResultNode>[], parentUri: vscode.Uri, folder: ResultFolder, labelProvider: LabelProvider) {
    for (const [ fileName, folderOrFile ] of Object.entries(folder.contents)) {
        const uri = vscode.Uri.joinPath(parentUri, fileName);
        const label = await labelProvider(uri);
        if (!label) continue;
        if (folderOrFile.kind === 'file') {
            parent.push(new SearchNode<FileResultNode>({
                kind: 'file',
                ext: folderOrFile.ext,
                label: label,
                locations: folderOrFile.locations.map(location => new SearchNode<FileResultLocationNode>({
                    kind: 'fileLocation',
                    location: location.location,
                    parentUri: uri,
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
            const childContents: SearchNode<SearchContainerNode | FileResultNode>[] = [];
            await processFolder(childContents, uri, folderOrFile, labelProvider);
            
            const results = getResultsCount(childContents);
            parent.push(new SearchNode<SearchContainerNode>({
                kind: 'searchContainer',
                contents: childContents,
                label: label,
                uri: uri,
                parentUri: parentUri,
                results: results,
            }));
        }
    }
}

type Categories = 'chapters' | 'snips' | 'scratchPad' | 'recycle' | 'workBible';
export async function recreateNodeTree (fileSystemGitGrep: FileSystemFormat): Promise<Record<Categories, SearchNode<SearchContainerNode>> | null> {

    const groups: Record<Categories, SearchNode<SearchContainerNode>> = {
        'chapters': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'chapters'),
            contents: [],
            results: 0,
            parentUri: null,
            label: 'Chapter'
        }),
        'snips': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'snips'),
            contents: [],
            results: 0,
            parentUri: null,
            label: 'Work Snips'
        }),
        'scratchPad': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'scratchPad'),
            contents: [],
            results: 0,
            parentUri: null,
            label: 'Scratch Pad'
        }),
        'recycle': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'recycling'),
            contents: [],
            results: 0,
            parentUri: null,
            label: 'Recycling Bin'
        }),
        'workBible': new SearchNode<SearchContainerNode>({
            kind: 'searchContainer',
            uri: vscode.Uri.joinPath(extension.rootPath, 'data', 'workBible'),
            contents: [],
            results: 0,
            parentUri: null,
            label: 'Work Notes'
        }),
    };

    const mainLabelProvider = (view: UriBasedView<OutlineNode>) => async (uri: vscode.Uri) => {
        const node = await view.getTreeElementByUri(uri);
        if (!node) return null;
        return node.data.ids.display;
    }

    const labelProviders: Record<Categories, LabelProvider> = {
        'chapters': mainLabelProvider(extension.ExtensionGlobals.outlineView),
        'snips': mainLabelProvider(extension.ExtensionGlobals.outlineView),
        'scratchPad': mainLabelProvider(extension.ExtensionGlobals.scratchPadView),
        'recycle': mainLabelProvider(extension.ExtensionGlobals.recyclingBinView),
        'workBible': async (uri: vscode.Uri) => {
            const note = extension.ExtensionGlobals.workBible.getNote(uri);
            if (!note) return null;
            return `(Note) ${note.noun}`;
        }
    };

    if (!('' in fileSystemGitGrep.folders.contents && 'data' in (fileSystemGitGrep.folders.contents[''] as ResultFolder).contents)) {
        return groups;
    }

    const dataFolder = (fileSystemGitGrep.folders.contents[''] as ResultFolder).contents['data'] as ResultFolder;
    for (const k of Object.keys(groups)) {
        const key: Categories = k as Categories;
        const folder = (dataFolder.contents[key] as ResultFolder);
        if (!folder) continue;
        const rootContainer = groups[key];
        const labelProvider = labelProviders[key];
        await processFolder(rootContainer.node.contents, rootContainer.node.uri, folder, labelProvider);

        rootContainer.node.results = getResultsCount(rootContainer.node.contents);
    }

    return groups;
}

function filterTree (node: SearchNode<SearchContainerNode>, description?: string[]): SearchNode<SearchContainerNode | FileResultNode> {
    if (node.node.contents.length === 1) {
        const nextup = node.node.contents[0];
        if (nextup.node.kind === 'file') {
            description?.push(node.node.label);
            description?.reverse()
            nextup.description = description?.join(' / ');
            return nextup;
        }
        const nextDescription = description 
            ? [ ...description, node.node.label ]
            : [ node.node.label ];
        return filterTree(nextup as SearchNode<SearchContainerNode>, nextDescription);
    }

    node.node.contents = node.node.contents.map(childNode => {
        if (childNode.node.kind === 'file') {
            return childNode;
        }
        return filterTree(childNode as SearchNode<SearchContainerNode>);
    });
    return node;
}

export function cleanNodeTree (trees: Record<Categories, SearchNode<SearchContainerNode>>): SearchNode<SearchContainerNode | FileResultNode>[] {
    const cleanedTrees: SearchNode<SearchContainerNode | FileResultNode>[] = [];
    for (const [ recordKey, searchTree ] of Object.entries(trees)) {
        if (searchTree.node.results === 0) continue;
        cleanedTrees.push(filterTree(searchTree));
    }
    return cleanedTrees;
}