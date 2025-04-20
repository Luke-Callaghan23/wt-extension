import * as vscode from 'vscode';
import * as extension from '../extension';
import { Buff } from '../Buffer/bufferSource';
import { TreeNode } from '../outlineProvider/outlineTreeProvider';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { RecyclingBinView } from '../recyclingBin/recyclingBinView';
import { OutlineView } from '../outline/outlineView';
import { ScratchPadView } from '../scratchPad/scratchPadView';
import { NotebookPanelNote, NotebookPanel } from '../notebook/notebookPanel';
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


export type VagueSearchSource = 'outline' | 'recycle' | 'scratch' | 'notebook' | null;
export type VagueNodeSearchResult = {
    source: 'scratch' | 'recycle' | 'outline',
    node: OutlineNode,
} | {
    source: 'notebook',
    node: NotebookPanelNote,
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
        const note = extension.ExtensionGlobals.notebook.getNote(target);
        if (note) return {
            source: 'notebook',
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
        
        const note = extension.ExtensionGlobals.notebook.getNote(target);
        if (note) return {
            source: 'notebook',
            node: note
        }
    } 



    return {
        source: null,
        node: null,
    }
}


// Determines which view column should be used for "auxilliary" documents being opened
// "auxilliary" documents are documents such as a scratch pad fragment or a notebook wtnote
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


export type SurroundingTextResult = {
    surroundingText: string,
    highlight: [ number, number ]
};

export function getSurroundingTextInRange(
    sourceDocument: vscode.TextDocument, 
    fullTextSize: number, 
    surroundingLocation: vscode.Location,
    surroundingBounds: number | [ number, number ],
    stopAtEol: boolean = false
): SurroundingTextResult {
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


export const getFullJSONStringFromLocation = (document: vscode.TextDocument, fullText: string, location: vscode.Location): string => {
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



export function defaultProgress <T>(title: string, worker: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>): Thenable<T> {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: title,
    }, worker);
}

type ValueOfTuple<T extends readonly any[]> = T[number];
export function getSectionedProgressReporter <T extends readonly string[]>(
    statuses: T,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    workDivision: number = 1,
): (status: ValueOfTuple<T>) => void {
    return (status: ValueOfTuple<T>) => {
        if (workDivision < 0) {
            progress.report({ message: status });
        }
        else {
            const thisProgress = 100 * workDivision * 1 / statuses.length
            progress.report({ message: status, increment: thisProgress });
        }
    };
};

export function progressOnViews <T> (
    viewIds: string[] | string, 
    worker: () => Promise<T>
): Thenable<T>;

export function progressOnViews <T> (
    viewIds: string[] | string, 
    title: string,
    worker: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
): Thenable<T>;


export function progressOnViews <T> (
    viewIds: string[] | string, 
    titleOrWorker: (() => Promise<T>) | string,
    workerOrNothing?: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>,
): Thenable<T> {
    return progressOnViews_impl(viewIds, titleOrWorker, workerOrNothing);
}


export function progressOnViews_impl <T> (
    viewIds: string[] | string, 
    titleOrWorker: (() => Promise<T>) | string,
    workerOrNothing?: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>,
): Thenable<T> {
    if (viewIds.length === 0 || typeof viewIds === 'string') {
        if (typeof titleOrWorker === 'function') {
            return titleOrWorker();
        }
        return defaultProgress(titleOrWorker, workerOrNothing!);
    }
    const next = viewIds.shift()!;
    return vscode.window.withProgress({ location: { viewId: next } }, () => progressOnViews_impl(viewIds, titleOrWorker, workerOrNothing));
}


// Dummy function to annotate an expression to a type
// To me, both `{  } as Type` and `<Type> {  } ` do not
//      have thorough enough type checking to be usefull
//      but I still want to be able to use expressions 
//      with type checking
// Passing a type and an object through this function
//      will do a thorough check on the passed object
//      against the parameter type
export function _ <T> (obj: T): T {
    return obj;
}

export async function showDocument (uri: vscode.Uri, options?: vscode.TextDocumentShowOptions) {
    if (uri.fsPath.toLowerCase().endsWith('.wtnote')) {
        return vscode.commands.executeCommand('vscode.openWith', uri, 'wt.notebook', options);
    }
    else {
        return vscode.window.showTextDocument(uri, options);
    }
}


export function capitalize(str: string, justFirstWord=true): string {
    if (justFirstWord) {
        const end = str.substring(1);
        return str[0].toLocaleUpperCase() + end;
    }

    // Iterate characters and capitalize each alphabetic
    let final: string = '';
    let current: string = '';
    for (let index = 0; index < str.length; index++) {
        if (/[^a-zA-Z]/.test(str[index])) {
            final += (current + str[index]);
            current = '';
            continue;
        }

        if (current.length === 0) {
            current += str[index].toLocaleUpperCase();
        }
        else {
            current += str[index];
        }
    }


    final += current;
    return final;
}
const titleCaseExceptions: RegExp = /^(a|the|and|as|at|but|by|down|for|from|if|in|into|like|near|nor|of|off|on|once|onto|or|over|past|so|than|that|to|upon|when|with|yet)([\.\?\:\;,\(\)!\&\s\+\-\n"\'^_*~]|$)/

export type Capitalization = 'firstLetter' | 'titleCase' | 'allCaps' | 'noCapFrFrOnGod';
export function getTextCapitalization(text: string): Capitalization {
    let cap: Capitalization = 'noCapFrFrOnGod';
    let capCount = 0;
    let startOfWord = true;
    let wordCount: number = 1;
    let capitalizedFirstLetterCount: number = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        // If the letter is not alphanumeric, count it as the start of a new word
        if (/\W/.test(char)) {
            if (!startOfWord) {
                // If start of word is already true that means we're either at the start or
                //      there's something wierd like '--' double punctuation or spacing, so do not 
                //      increment the word count quite yet
                wordCount++;
            }
            capCount++;
            startOfWord = true;
            continue
        }

        // If this character is a capital or the start of one of the title case exceptions
        if (/[A-Z]/.test(char) || (startOfWord && titleCaseExceptions.exec(text.substring(index))?.index === 0 && index !== 0)) {

            // And index === 0: then we know for sure this is a candidate for first letter capitalization
            if (index === 0) {
                cap = 'firstLetter';
            }

            // And it is the start of the word, then increase the count of the capitalized starts of words
            if (startOfWord) {
                capitalizedFirstLetterCount++;
            }
            
            capCount ++ ;
        }

        // Reset word start flag
        startOfWord = false;
    }

    if (capCount === text.length) {
        cap = 'allCaps';
    }
    else if (capitalizedFirstLetterCount === wordCount && wordCount > 1) {
        cap = 'titleCase';
    }
    return cap;
}

export function transformToCapitalization(input: string, capitalization: Capitalization): string {
    switch (capitalization) {
        case 'allCaps': return input.toUpperCase();
        case 'firstLetter': return capitalize(input.toLocaleLowerCase());
        case 'titleCase': return capitalize(input.toLocaleLowerCase(), false);
        case 'noCapFrFrOnGod': return input.toLocaleLowerCase();
    }
}
