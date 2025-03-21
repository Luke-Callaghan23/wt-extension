import * as vscode from 'vscode';
import * as extension from '../extension';
import { Buff } from '../Buffer/bufferSource';
import { TreeNode } from '../outlineProvider/outlineTreeProvider';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { RecyclingBinView } from '../recyclingBin/recyclingBinView';
import { OutlineView } from '../outline/outlineView';
import { ScratchPadView } from '../scratchPad/scratchPadView';
import { Note, WorkBible } from '../workBible/workBible';
import { TabLabels } from '../tabLabels/tabLabels';
import * as childProcess from 'child_process'
import * as vscodeUri from 'vscode-uri';
import { HasGetUri, UriBasedView } from '../outlineProvider/UriBasedView';

export type PromptOptions = {
    placeholder: string,
    prompt: string
};

export async function prompt (options: PromptOptions): Promise<string> {
    let response: string|undefined;
    while (!response) {
        response = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            placeHolder: options.placeholder,
            prompt: options.prompt,
        });
    }
    return response;
}

export type QuickPickOptions = {
    prompt: string,
    placeholder: string,
    options: string[],
};

export async function quickPickPrompt (options: QuickPickOptions): Promise<string> {
	const result = await vscode.window.showQuickPick(options.options, {
		placeHolder: options.placeholder,
        ignoreFocusOut: true,
        title: options.prompt,
	});

    if (!result) {
        throw new Error("Not possible.");
    }

    return result;
}

export type ConfigFileInfoExpanded = {
    title: string,
    ordering: number,
    fileName: string,
    node: OutlineNode
};

export type ConfigFileInfo = {
    title: string,
    ordering: number
};

export function getLatestOrdering (configData: { [index: string]: ConfigFileInfo }): number {
    let max = -1;
    Object.getOwnPropertyNames(configData).filter(name => name !== 'self').forEach(name => {
        const info = configData[name];
        if (info.ordering > max) {
            max = info.ordering;
        }
    });
    return max;
}

export async function readDotConfig (path: vscode.Uri): Promise<{ [index: string]: ConfigFileInfo } | null> {
    try {
        const dotConfigJSON = extension.decoder.decode(await vscode.workspace.fs.readFile(path));
        const dotConfig: { [index: string]: ConfigFileInfo } = JSON.parse(dotConfigJSON);
        return dotConfig;
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error reading .config file '${path}': ${e}`);
        return null;
    }
}

export async function writeDotConfig (path: vscode.Uri, dotConfig: { [index: string]: ConfigFileInfo }) {
    try {
        const dotConfigJSON = JSON.stringify(dotConfig);
        await vscode.workspace.fs.writeFile(path, Buff.from(dotConfigJSON, 'utf-8'));
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error writing .config file '${path}': ${e}`);
        return null;
    }
}


export function getNonce () {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function hexToRgb (hex: string): null | { r: number, g: number, b: number } {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

export function clamp(num: number, min: number, max: number) {
    return num <= min 
        ? min 
        : num >= max 
            ? max 
            : num
}


export type VagueSearchSource = 'outline' | 'recycle' | 'scratch' | 'workBible' | null;
export type VagueNodeSearchResult = {
    source: 'scratch' | 'recycle' | 'outline',
    node: OutlineNode,
} | {
    source: 'workBible',
    node: Note,
} | {
    source: null,
    node: null
};

export async function vagueNodeSearch (
    target: vscode.Uri,
    targetIsBasename?: boolean
): Promise<VagueNodeSearchResult> {
    const relative = target.fsPath.replaceAll(extension.rootPath.fsPath, "");
        
    
    if (!(
        relative.endsWith("wt") 
        || relative.endsWith("wtnote")
        || relative !== target.fsPath
    )) return { node:null, source:null };
    if (relative.includes("tmp/") || relative.includes("tmp\\")) return { node:null, source:null };


    if (relative.includes("recycling")) {
        const node = await extension.ExtensionGlobals.recyclingBinView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            node: node,
            source: 'recycle'
        }
    }
    else if (relative.includes("scratchPad")) {
        const node = await extension.ExtensionGlobals.scratchPadView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            node: node,
            source: 'scratch',
        }
    }
    else if (relative.endsWith(".wtnote")) {
        const note = extension.ExtensionGlobals.workBible.getNote(target);
        if (note) return {
            source: 'workBible',
            node: note
        }
    }
    else {
        // If none of the previous paths worked, brute force search for all locations

        // Most likely it is in the outline, so search there first
        let node = await extension.ExtensionGlobals.outlineView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            source: 'outline',
            node: node,
        }

        node = await extension.ExtensionGlobals.recyclingBinView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            node: node,
            source: 'recycle'
        }
        node = await extension.ExtensionGlobals.scratchPadView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            node: node,
            source: 'scratch',
        }
        
        const note = extension.ExtensionGlobals.workBible.getNote(target);
        if (note) return {
            source: 'workBible',
            node: note
        }
    } 



    return {
        source: null,
        node: null,
    }
}


// Determines which view column should be used for "auxilliary" documents being opened
// "auxilliary" documents are documents such as a scratch pad fragment or a work bible wtnote
// since these documents are often not the main thing a user will be editing, we'll *usually* want to open the 
//      aux document in in the "Beside" view column
// BUT, if the currently active view column is already a document of the same type as the aux document being
//      opened, then we want to open the document in the same view column as that doc
export async function determineAuxViewColumn <T>(getter: ((uri: vscode.Uri)=>Promise<T | null>|(T | null))): Promise<vscode.ViewColumn> {
    
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const activeDocumentUri = activeEditor.document.uri;
        if (await getter(activeDocumentUri)) {
            return vscode.ViewColumn.Active;
        }
    }
    return vscode.ViewColumn.Beside;
}

export const formatFsPathForCompare = (path: vscode.Uri): string => {
    let fsPath = path.fsPath;
    if (fsPath.endsWith("\\") || fsPath.endsWith("/")) {
        fsPath = fsPath.substring(0, fsPath.length-1);
    }
    return fsPath;
};

export const compareFsPath = (self: vscode.Uri, other: vscode.Uri): boolean => {
    const selfPath = formatFsPathForCompare(self);
    const otherPath = formatFsPathForCompare(other);
    return selfPath === otherPath;
}

export const getFsPathKey = <T>(path: vscode.Uri, obj: { [index: string]: T }): T | undefined => {
    const fsPath = formatFsPathForCompare(path);
    if (fsPath in obj) {
        return obj[fsPath];
    }
    else return undefined;
}


export const setFsPathKey = <T>(path: vscode.Uri, value: T, obj: { [index: string]: T }) => {
    const fsPath = formatFsPathForCompare(path);
    obj[fsPath] = value;
}



export const isSubdirectory = (sub: vscode.Uri, full: vscode.Uri): boolean => {

    const normalizedRoot = extension.rootPath.fsPath.toLowerCase().replaceAll("\\", "/");

    const subPath = sub.fsPath;
    const fullPath = full.fsPath;

    // Normalize paths to handle different OS conventions (e.g., slashes vs. backslashes)
    const normalizedSub = subPath.toLowerCase().replaceAll("\\", "/").replaceAll(normalizedRoot, "");
    const normalizedFull = fullPath.toLowerCase().replaceAll("\\", "/").replaceAll(normalizedRoot, "");

    // Check if path2 starts with path1
    return normalizedFull.startsWith(normalizedSub);
};

export function getAllIndices (str: string, subStr: string): number[] {
    const indices: number[] = [];
    let startIndex = 0;

    while (true) {
        const index = str.indexOf(subStr, startIndex);
        if (index === -1) break;
        indices.push(index);
        startIndex = index + 1; // Move to the next position after the found substring
    }

    return indices;
}

export async function statFile (uri: vscode.Uri): Promise<vscode.FileStat | null> {
    try {
        return vscode.workspace.fs.stat(uri);
    }
    catch (err) {
        return null;
    }
}

export function getRelativePath (uri: vscode.Uri): string {
    return uri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
}


export function getSurroundingTextInRange(
    sourceDocument: vscode.TextDocument, 
    fullTextSize: number, 
    surroundingLocation: vscode.Location,
    surroundingBounds: number | [ number, number ],
    stopAtEol: boolean = false
): {
    surroundingText: string,
    highlight: [ number, number ]
} {
    if (typeof surroundingBounds === 'number') {
        surroundingBounds = [ surroundingBounds, surroundingBounds ];
    }
    
    
    let eolOffset = Number.MAX_VALUE;
    if (stopAtEol) {
        const eolPosition = new vscode.Position(surroundingLocation.range.end.line + 1, 0);
        eolOffset = sourceDocument.offsetAt(eolPosition) - sourceDocument.eol;
    }

    const surroundingTextStart = Math.max(sourceDocument.offsetAt(surroundingLocation.range.start) - surroundingBounds[0], 0);
    const surroundingTextEnd = Math.min(sourceDocument.offsetAt(surroundingLocation.range.end) + surroundingBounds[1], fullTextSize, eolOffset);
    
    let surroundingTextHighlightStart = sourceDocument.offsetAt(surroundingLocation.range.start) - surroundingTextStart;
    let surroundingTextHighlightEnd = surroundingTextHighlightStart + (sourceDocument.offsetAt(surroundingLocation.range.end) - sourceDocument.offsetAt(surroundingLocation.range.start));
    
    let surroundingText = sourceDocument.getText(new vscode.Selection(sourceDocument.positionAt(surroundingTextStart), sourceDocument.positionAt(surroundingTextEnd)));
    if (surroundingTextStart !== 0 && surroundingBounds[0] !== 0) {
        surroundingText = '…' + surroundingText;
        surroundingTextHighlightEnd += 1;
        surroundingTextHighlightStart += 1;
    }
    if (surroundingTextEnd !== fullTextSize) {
        if (stopAtEol) {
            if (surroundingTextEnd !== eolOffset) {
                surroundingText += '…';
            }
        }
        else {
            surroundingText += '…';
        }
    }
    
    return {
        surroundingText: surroundingText,
        highlight: [ surroundingTextHighlightStart, surroundingTextHighlightEnd ],
    }
}
