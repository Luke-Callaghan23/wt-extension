import * as vscode from 'vscode';
import { formatFsPathForCompare, getRelativePath, VagueSearchSource } from '../miscTools/help';
import { HasGetUri, UriBasedView } from '../outlineProvider/UriBasedView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import * as extension from '../extension';
import * as vscodeUri from 'vscode-uri';
import { SearchNodeKind } from './searchResultsView';


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


function getSurroundingTextInRange(
    sourceDocument: vscode.TextDocument, 
    fullTextSize: number, 
    surroundingLocation: vscode.Location,
    surroundingBounds: number | [ number, number ]
): {
    surroundingText: string,
    highlight: [ number, number ]
} {
    if (typeof surroundingBounds === 'number') {
        surroundingBounds = [ surroundingBounds, surroundingBounds ];
    }
    
    const surroundingTextStart = Math.max(sourceDocument.offsetAt(surroundingLocation.range.start) - surroundingBounds[0], 0);
    const surroundingTextEnd = Math.min(sourceDocument.offsetAt(surroundingLocation.range.end) + surroundingBounds[1], fullTextSize - 1);
    
    let surroundingTextHighlightStart = sourceDocument.offsetAt(surroundingLocation.range.start) - surroundingTextStart;
    let surroundingTextHighlightEnd = surroundingTextHighlightStart + (sourceDocument.offsetAt(surroundingLocation.range.end) - sourceDocument.offsetAt(surroundingLocation.range.start));
    
    let surroundingText = sourceDocument.getText(new vscode.Selection(sourceDocument.positionAt(surroundingTextStart), sourceDocument.positionAt(surroundingTextEnd)));
    if (surroundingTextStart !== 0) {
        surroundingText = '…' + surroundingText;
        surroundingTextHighlightEnd += 1;
        surroundingTextHighlightStart += 1;
    }
    if (surroundingTextEnd !== fullTextSize - 1) {
        surroundingText += '…';
    }
    
    return {
        surroundingText: surroundingText,
        highlight: [ surroundingTextHighlightStart, surroundingTextHighlightEnd ],
    }
}


export async function createFileSystemTree (locations: vscode.Location[]): Promise<FileSystemFormat> {
    const root: FileSystemFormat = {
        results: locations.length,
        folders: {
            kind: 'folder',
            contents: {}
        }
    };

    const entries: [string, vscode.TextDocument][] = await Promise.all(locations.map(loc => {
        const res: Thenable<[string, vscode.TextDocument]> = vscode.workspace.openTextDocument(loc.uri).then(doc => {
            return [ formatFsPathForCompare(doc.uri), doc ] ;
        });
        return res;
    }));

    const docMap: Record<string, vscode.TextDocument> = {};
    for (const [ uriFsPath, doc ] of entries) {
        docMap[uriFsPath] = doc;
    }

    for (const location of locations) {
        const path = getRelativePath(location.uri);
        let current: ResultFolder = root.folders;
        let relativePath: string[] = [];

        if (location.range.start.character !== 0) {
            location.range = new vscode.Range(
                new vscode.Position(location.range.start.line, location.range.start.character - 1),
                new vscode.Position(location.range.end.line, location.range.end.character - 1),
            )
        }

        const pathSegments = path.split("/");
        for (let index = 0; index < pathSegments.length; index++) {
            const segment = pathSegments[index];
            relativePath.push(segment);

            const uri = vscode.Uri.joinPath(extension.rootPath, ...relativePath);
            const isLeaf = index === pathSegments.length - 1;

            const cachedDocument = docMap[formatFsPathForCompare(location.uri)];
            const fullTextSize = cachedDocument.getText().length;

            const smallSurrounding = getSurroundingTextInRange(cachedDocument, fullTextSize, location, [ 20, 100 ]);
            const largerSurrounding = getSurroundingTextInRange(cachedDocument, fullTextSize, location, 400);

            if (current.contents[segment]) {
                if (isLeaf) {
                    (current.contents[segment] as ResultFile).locations.push({
                        location: location,
                        surroundingText: smallSurrounding.surroundingText,
                        surroundingTextHighlight: smallSurrounding.highlight,
                        largerSurrounding: largerSurrounding.surroundingText,
                        largerSurroundingHighlight: largerSurrounding.highlight
                    });
                }
                else {
                    current = (current.contents[segment] as ResultFolder);
                }
            }
            else {
                if (isLeaf) {
                    current.contents[segment] = {
                        kind: 'file',
                        ext: vscodeUri.Utils.extname(uri),
                        locations: [ {
                            location: location,
                            surroundingText: smallSurrounding.surroundingText,
                            surroundingTextHighlight: smallSurrounding.highlight,
                            largerSurrounding: largerSurrounding.surroundingText,
                            largerSurroundingHighlight: largerSurrounding.highlight
                        } ]
                    };
                }
                else {
                    const nextFolder: ResultFolder = {
                        kind: 'folder',
                        contents: {}
                    };
                    current.contents[segment] = nextFolder;
                    current = nextFolder;
                }
            }
        }
    }
    return root;
}



export type NodeTreeFormat = {
    results: number;
    tabLabels: vscode.Uri[];
    data: Record<Exclude<VagueSearchSource, null>, OutlineNode[]>
}


export type FileResultNode = {
    kind: 'file';
    ext: string;
    uri: vscode.Uri;
    parentUri: vscode.Uri;
    label: string;
    locations: SearchNode<FileResultLocationNode>[]
}

export type FileResultLocationNode = {
    kind: 'fileLocation';
    uri: vscode.Uri;
    parentUri: vscode.Uri;
    location: vscode.Location;
    surroundingText: string;
    surroundingTextHighlight: [ number, number ];
    largerSurroundingText: string;
    largerSurroundingTextHighlight: [ number, number ];
};

export type SearchContainerNode = {
    kind: 'searchContainer';
    uri: vscode.Uri;
    parentUri: vscode.Uri | null;
    label: string;
    results: number;
    contents: SearchNode<SearchContainerNode | FileResultNode>[];
};


export class SearchNode<T extends FileResultNode | SearchContainerNode | FileResultLocationNode> implements HasGetUri {
    node: T;
    description?: string;
    constructor (node: T) {
        this.node = node;
    }

    getUri (): vscode.Uri {
        return this.node.uri;
    }
    getParentUri (): vscode.Uri | null {
        return this.node.parentUri;
    }
    
    getLabel (): string | vscode.TreeItemLabel {
        if (this.node.kind === 'file') {
            return `(${this.node.locations.length}) ${this.node.label}`
        }
        else if (this.node.kind === 'fileLocation') {
            return <vscode.TreeItemLabel> {
                label: this.node.surroundingText,
                highlights: [this.node.surroundingTextHighlight]
            }
        }
        else if (this.node.kind === 'searchContainer') {
            return `(${this.node.results}) ${this.node.label}`
        }
        throw 'Not accessible';
    }

    getTooltip (): string | vscode.MarkdownString {
        if (this.node.kind !== 'fileLocation') {
            return this.node.label;
        }

        // Split on the highlights for the larger surrounding text
        const splits = [
            this.node.largerSurroundingText.substring(0, this.node.largerSurroundingTextHighlight[0]),
            this.node.largerSurroundingText.substring(this.node.largerSurroundingTextHighlight[0], this.node.largerSurroundingTextHighlight[1]),
            this.node.largerSurroundingText.substring(this.node.largerSurroundingTextHighlight[1])
        ]

        // Clean all the markings from the three sections 
        // (Need to do cleaning here or else the `this.node.largerSurroundingTextHighlights` indices might get messed up)
        const cleaned = splits.map(splt => splt.replaceAll(/[#^*_~]/g, ''));

        const joined = cleaned[0] + '<mark>' + cleaned[1] + '</mark>' + cleaned[2];
        const finalMarkdown = joined.replaceAll(/\n/g, '\n\n');

        // Create md and mark it as supporting HTML
        const md = new vscode.MarkdownString(finalMarkdown);
        md.supportHtml = true;
        return md;
    }
    
    async getChildren (
        filter: boolean, 
        insertIntoNodeMap: (node: HasGetUri, uri: vscode.Uri) => void
    ): Promise<SearchNode<FileResultNode | SearchContainerNode | FileResultLocationNode>[]> {
        if (this.node.kind === 'file') {
            return this.node.locations;
        }
        else if (this.node.kind === 'fileLocation') {
            return [];
        }
        else if (this.node.kind === 'searchContainer') {
            return this.node.contents;
        }
        throw 'Not accessible';
    }
}

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