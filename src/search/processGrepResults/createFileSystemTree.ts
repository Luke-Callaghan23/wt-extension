import * as vscode from 'vscode';
import { formatFsPathForCompare, getRelativePath, getSurroundingTextInRange, VagueSearchSource } from '../../miscTools/help';
import { OutlineNode } from '../../outline/nodes_impl/outlineNode';
import * as extension from '../../extension';
import * as vscodeUri from 'vscode-uri';


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


