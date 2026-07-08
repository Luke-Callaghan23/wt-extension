import * as vscode from 'vscode';
import { Extension } from   '../extension';
import { Buff } from '../Buffer/bufferSource';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { NotebookPanelNote, NotebookPanel } from '../notebook/notebookPanel';
import { OutlineView } from '../outline/outlineView';

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
    description?: string
    ordering: number,
    fileName: string,
    node: OutlineNode
};

export type ConfigFileInfo = {
    title: string,
    description?: string,
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
        const dotConfigJSON = Extension.decoder.decode(await vscode.workspace.fs.readFile(path));
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
    const relative = target.fsPath.replaceAll(Extension.rootPath.fsPath, "");
    
    if (!(
        relative.endsWith(".wt") 
        || relative.endsWith(".wtnote")
        || relative.endsWith(".md")
        || relative !== target.fsPath
    )) return { node:null, source:null };
    if (relative.includes("tmp/") || relative.includes("tmp\\")) return { node:null, source:null };


    if (relative.includes("recycling")) {
        const node = await Extension.recyclingBinView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            node: node,
            source: 'recycle'
        }
    }
    else if (relative.includes("scratchPad")) {
        const node = await Extension.scratchPadView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            node: node,
            source: 'scratch',
        }
    }
    else if (relative.endsWith(".wtnote")) {
        const note = Extension.notebookPanel.getNote(target);
        if (note) return {
            source: 'notebook',
            node: note
        }
    }
    else {
        // If none of the previous paths worked, brute force search for all locations

        // Most likely it is in the outline, so search there first
        let node = await Extension.outlineView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            source: 'outline',
            node: node,
        }

        node = await Extension.recyclingBinView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            node: node,
            source: 'recycle'
        }
        node = await Extension.scratchPadView.getTreeElementByUri(target, undefined, targetIsBasename);
        if (node) return {
            node: node,
            source: 'scratch',
        }
        
        const note = Extension.notebookPanel.getNote(target);
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
// But, if the current document is already an auxiliary document of the same type as the document to open,
//      we want to reuse the active view column
// Param "getter" is a function that recieves the URI of the current active document and returns that uri's node
//      if the node is the same type as the active document
export async function determineAuxViewColumn <T>(getter: ((uri: vscode.Uri)=>Promise<T | null>|(T | null))): Promise<vscode.ViewColumn> {
    
    const activeTextEditor = vscode.window.activeTextEditor;
    const activeNotebookEditor = vscode.window.activeNotebookEditor;

    let uri: vscode.Uri | null = null;
    if (activeNotebookEditor) {
        uri = activeNotebookEditor.notebook.uri;
    }
    else if (activeTextEditor) {
        uri = activeTextEditor.document.uri;
    }

    if (uri) {
        const node = await getter(uri);
        if (node) {
            return vscode.ViewColumn.Active;
        }
    }
    return vscode.ViewColumn.Beside;
}

export type UriFsPathFormatted = string;
export const formatFsPathForCompare = (path: vscode.Uri): UriFsPathFormatted => {
    let fsPath = path.fsPath;
    if (fsPath.endsWith("\\") || fsPath.endsWith("/")) {
        fsPath = fsPath.substring(0, fsPath.length-1);
    }
    if (path.fragment && path.fragment.length > 0) {
        fsPath += `#${path.fragment}`;
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

    const normalizedRoot = Extension.rootPath.fsPath.toLowerCase().replaceAll("\\", "/").replaceAll(/\/+/g, '/');

    const subPath = sub.fsPath;
    const fullPath = full.fsPath;

    // Normalize paths to handle different OS conventions (e.g., slashes vs. backslashes)
    const normalizedSub = subPath.toLowerCase().replaceAll("\\", "/").replaceAll(normalizedRoot, "").replaceAll(/\/+/g, '/');
    const normalizedFull = fullPath.toLowerCase().replaceAll("\\", "/").replaceAll(normalizedRoot, "").replaceAll(/\/+/g, '/');

    // Check if path2 starts with path1
    return normalizedFull.startsWith(normalizedSub);
};

export function getAllIndices (str: string, subStr: string): number[] {
    const indices: number[] = [];
    let startIndex = 0;

    str = stripDiacritics(str);
    subStr = stripDiacritics(str);

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
        const stat = await vscode.workspace.fs.stat(uri);
        return stat;
    }
    catch (err) {
        return null;
    }
}

export function getRelativePath (uri: vscode.Uri): string {
    return uri.fsPath.replace(Extension.rootPath.fsPath, '').replaceAll("\\", '/');
}


export type SurroundingTextResult = {
    surroundingText: string,
    highlight: [ number, number ]
};

function applySingleHighlightToMarkdown__impl (surroundingText: string, highlight: [number, number]) {
    // Split on the highlights for the larger surrounding text
    const splits = [
        surroundingText.substring(0, highlight[0]),
        surroundingText.substring(highlight[0], highlight[1]),
        surroundingText.substring(highlight[1])
    ];
    
    // Clean all the markings from the three sections 
    // (Need to do cleaning here or else the `highlights` indices might get messed up)
    const cleaned = splits.map(splt => splt.replaceAll(/[#^*_~]/g, ''));
    
    const joined = cleaned[0] + '<mark>' + cleaned[1] + '</mark>' + cleaned[2];
    const finalMarkdown = joined.replaceAll(/\n/g, '\n\n');
    return finalMarkdown;
}

export function applyHighlightToMarkdownString (surroundingText: string, highlight: [number, number]) {
    const finalMarkdown = applySingleHighlightToMarkdown__impl(surroundingText, highlight);
    
    // Create md and mark it as supporting HTML
    const md = new vscode.MarkdownString(finalMarkdown);
    md.supportHtml = true;
    return md;
}

export function applyMultiHighlightToMarkdownString (surroundingText: string, highlights: [number, number][]) {
    // Since each highlight involves adding text to the full string, we cannot iterate forwards through the text
    //      because each subsequent highlight will be incorrect
    // So, first ensure the highligts are in reverse order where h[n].start > h[n-1].start for each n
    const reverseOrderedHighlights = highlights.sort(([aStart, _], [ bStart, __]) => {
        // Descending sort on start
        return bStart - aStart;
    })
    
    // Repeatedly apply highlights to the markdown
    let finalMarkdown = surroundingText;
    for (const highlight of reverseOrderedHighlights) {
        finalMarkdown = applySingleHighlightToMarkdown__impl(finalMarkdown, highlight);
    }

    // Create md and mark it as supporting HTML
    const md = new vscode.MarkdownString(finalMarkdown);
    md.supportHtml = true;
    return md;
}

export function getSurroundingTextInRange(
    fullText: string, 
    surroundingStartOff: number,
    surroundingEndOff: number,
    surroundingBounds: number | [ number, number ],
    stopAtEol: boolean = false
): SurroundingTextResult {
    if (typeof surroundingBounds === 'number') {
        surroundingBounds = [ surroundingBounds, surroundingBounds ];
    }
    
    let eolOffset = Number.MAX_VALUE;
    if (stopAtEol) {
        eolOffset = surroundingEndOff;
        while (eolOffset < fullText.length && fullText[eolOffset] != '\n') {
            eolOffset++;
        }
    }

    const surroundingTextStart = Math.max(surroundingStartOff - surroundingBounds[0], 0);
    const surroundingTextEnd = Math.min(surroundingEndOff + surroundingBounds[1], fullText.length, eolOffset);
    
    let surroundingTextHighlightStart = surroundingStartOff - surroundingTextStart;
    let surroundingTextHighlightEnd = surroundingTextHighlightStart + (surroundingEndOff - surroundingStartOff);
    
    let surroundingText = fullText.substring(surroundingTextStart, surroundingTextEnd);
    if (surroundingTextStart !== 0 && surroundingBounds[0] !== 0) {
        surroundingText = '…' + surroundingText;
        surroundingTextHighlightEnd += 1;
        surroundingTextHighlightStart += 1;
    }
    if (surroundingTextEnd !== fullText.length) {
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


export type JSONStringInfo = {
    jsonString: string,
    startOff: number,
    endOff: number
};

export type JSONContextInfo =  {
    kind: 'string',
    stringRange: vscode.Range,
} | {
    kind: 'arrayMember'
    arrayRange: vscode.Range,
} | {
    kind: 'objectPropertyKey',
    keyName: string,
    objectRange: vscode.Range,
} | {
    kind: 'objectPropertyValue',
    keyName: string,
    valueString?: string,
    objectRange: vscode.Range,
}

// export type JSONStringContextInfo = {
//     stringInfo: JSONStringInfo, 
//     context: JSONContextInfo
// }

// Recieves a JSON document and a location within the document that is inside of a JSON-formatted string
// Returns information about the start and end of the json string where the json location points
export const getFullJSONStringFromLocation = (document: vscode.TextDocument, fullText: string, location: vscode.Location): JSONStringInfo => {
    const startOff = document.offsetAt(location.range.start);
    const endOff = document.offsetAt(location.range.end);

    let stringStartOff;
    if (fullText[startOff] === '"') {
        stringStartOff = startOff + 1;
    }
    else {
        for (stringStartOff = startOff - 1; stringStartOff >= 0; stringStartOff--) {
            if (fullText[stringStartOff] === '"' && fullText[stringStartOff - 1] !== '\\') {
                stringStartOff++;
                break;
            }
        }
    }


    let stringEndOff;
    for (stringEndOff = endOff; stringEndOff < fullText.length; stringEndOff++) {
        if (fullText[stringEndOff] === '"' && fullText[stringEndOff - 1] !== '\\') {
            break;
        }
    }

    return {
        jsonString: document.getText(new vscode.Range(document.positionAt(stringStartOff), document.positionAt(stringEndOff))).replaceAll('\\"', '"'),
        startOff: stringStartOff,
        endOff: stringEndOff,
    };
}


export const getJSONContext = (document: vscode.TextDocument, fullText: string, offset: number): JSONContextInfo | null => {
    // First determine if we are inside of a string
    // Search starting from the beginning all the way up until the idx parameter for all non-escaped double quotes
    let inString: boolean = false;
    for (let idx = 0; idx <= offset; idx++) {
        if (fullText[idx] === '\\') {
            idx++;
            continue;
        }

        if (fullText[idx] === '"') {
            inString = !inString;
        }
    }

    let backwardsCursorStart: number;
    let forwardsCursorStart: number;

    let keystring: JSONStringInfo | null = null;
    let jsonstring: JSONStringInfo | null = null;
    let isPropertyKey: boolean = false;
    let isPropertyValue: boolean = false;
    if (inString) {
        jsonstring = getFullJSONStringFromLocation(document, fullText, new vscode.Location(document.uri, new vscode.Range(
            document.positionAt(offset),
            document.positionAt(offset + 1)
        )));
        
        // Search for the next non-whitespace character in the JSON document, following the 
        let nextNonWhitespaceOff = jsonstring.endOff + 2;
        while (/\s/.test(fullText[nextNonWhitespaceOff])) {
            nextNonWhitespaceOff++;
        }
    
        if (fullText[nextNonWhitespaceOff] === ':') {
            isPropertyKey = true;
        }

        backwardsCursorStart = jsonstring.startOff - 2;
        forwardsCursorStart = nextNonWhitespaceOff;

        // Search for the previous non-whitespace character, to see if the 
        //      matched JSON string was the value of an object property
        let prevNonWhitespaceOff = backwardsCursorStart;
        while (/\s/.test(fullText[prevNonWhitespaceOff])) {
            prevNonWhitespaceOff--;
        }

        if (fullText[prevNonWhitespaceOff] === ':') {
            
            // If this is the value of an object property, get the text value of the property key
            // Move the cursor back until you find the start of the property key JSON string
            while (fullText[prevNonWhitespaceOff] !== '"') {
                prevNonWhitespaceOff--;
            }
            // Move the cursor back once again to move into the JSON string itself
            prevNonWhitespaceOff--;

            keystring = getFullJSONStringFromLocation(document, fullText, new vscode.Location(
                document.uri, 
                new vscode.Range(
                    document.positionAt(prevNonWhitespaceOff),
                    document.positionAt(prevNonWhitespaceOff)
                )
            ));
            isPropertyValue = true;
        }
    

    }
    else {

        // Search previous

        // Search backwards for any non-structural character 
        let prevCharCursor = offset - 1;
        while (!(/[{}\[\]:,"]/.test(fullText[prevCharCursor]))) {
            prevCharCursor--;
        }

        if (fullText[prevCharCursor] === ':') {
            isPropertyValue = true;

            // If this is the value of an object property, get the text value of the property key
            // Move the cursor back until you find the start of the property key JSON string
            while (fullText[prevCharCursor] !== '"') {
                prevCharCursor--;
            }
            // Move the cursor back once again to move into the JSON string itself
            prevCharCursor--;

            keystring = getFullJSONStringFromLocation(document, fullText, new vscode.Location(document.uri, new vscode.Range(
                document.positionAt(prevCharCursor),
                document.positionAt(prevCharCursor)
            )));

            backwardsCursorStart = keystring.startOff - 2;
            forwardsCursorStart = offset + 1;
        }
        else {
            backwardsCursorStart = offset - 1;
            forwardsCursorStart = offset + 1;
        }
    }
    
    // Now, to get the bounds of the object itself, search for the previous (unclosed) opening curly brace
    //      in the reverse direction
    // And the next (unopened) closing curly brace in the forward direction
    let enclosingStart: number | null = null;
    let enclosingEnd: number | null = null;

    let enclosingIsCurly = false;

    // Search backwards for object start
    let cursor = backwardsCursorStart;

    let curlyStack = 0;
    let squareStack = 0;
    while (cursor >= 0) {
        // Skip over any strings
        if (fullText[cursor] === '"') {
            const skipme = getFullJSONStringFromLocation(document, fullText, new vscode.Location(
                document.uri, 
                new vscode.Range(
                    document.positionAt(cursor),
                    document.positionAt(cursor)
                )
            ));
            cursor = skipme.startOff - 2;
            continue;
        }

        if (fullText[cursor] === '}') {
            curlyStack++;
        }

        if (fullText[cursor] === '{') {
            if (curlyStack === 0) {
                enclosingStart = cursor;
                enclosingIsCurly = true;
                break;
            }
            else {
                curlyStack--;
            }
        }

        if (fullText[cursor] === ']') {
            squareStack++;
        }

        if (fullText[cursor] === '[') {
            if (squareStack === 0) {
                enclosingStart = cursor;
                enclosingIsCurly = false;
                break;
            }
            else {
                squareStack--;
            }
        }

        cursor--;
    }

    let searchEnclosingStart: string;
    let searchEnclosingEnd: string;
    if (enclosingIsCurly) {
        searchEnclosingStart = '{';
        searchEnclosingEnd = '}';
    }
    else {
        searchEnclosingStart = '[';
        searchEnclosingEnd = ']';
    }

    // Search forwards for object end
    cursor = forwardsCursorStart;

    let enclosingStack = 0;
    while (cursor < fullText.length) {
        // Skip over any strings
        if (fullText[cursor] === '"') {
            const skipme = getFullJSONStringFromLocation(document, fullText, new vscode.Location(
                document.uri, 
                new vscode.Range(
                    document.positionAt(cursor+1),
                    document.positionAt(cursor+1)
                )
            ));
            cursor = skipme.endOff + 1;
            continue;
        }

        if (fullText[cursor] === searchEnclosingStart) {
            enclosingStack++;
        }

        if (fullText[cursor] === searchEnclosingEnd) {
            if (enclosingStack === 0) {
                enclosingEnd = cursor;
                break;
            }
            else {
                enclosingStack--;
            }
        }

        cursor++;
    }

    if (enclosingStart === null || enclosingEnd === null) {
        return null;
    }

    const enclosingRange = new vscode.Range (
        document.positionAt(enclosingStart), 
        document.positionAt(enclosingEnd + 1)
    );

    if (enclosingIsCurly) {

        if (isPropertyKey && jsonstring) {
            return {
                kind: 'objectPropertyKey',
                keyName: jsonstring.jsonString,
                objectRange: enclosingRange
            };
        }
        else if (isPropertyValue && keystring) {
            return {
                kind: 'objectPropertyValue',
                keyName: keystring.jsonString,
                valueString: jsonstring?.jsonString,
                objectRange: enclosingRange
            };
        }
    }
    else {
        return {
            kind: 'arrayMember',
            arrayRange: enclosingRange
        }
    }

    return null;
};

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
export function __ <T> (obj: T): T {
    return obj;
}

export async function showDocument (uri: vscode.Uri, options?: vscode.TextDocumentShowOptions) {
    if (uri.fsPath.toLowerCase().endsWith('.wtnote')) {
        return vscode.commands.executeCommand('vscode.openWith', uri, 'wt.notebook', options);
    }
    else {
        // If it is specifically noted by the caller to not preview then we do not want
        //      `showTextDocumentWithPreview` to override that
        if (options && options.preview === false) {
            return vscode.window.showTextDocument(uri, options);
        }
        return showTextDocumentWithPreview(uri, options);
    }
}


export function capitalize(str: string, justFirstWord=true): string {
    if (str === '') return str;
    
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


export async function showTextDocumentWithPreview (docOrUri: vscode.Uri | vscode.TextDocument, options?: vscode.TextDocumentShowOptions) {
    
    const uri = docOrUri instanceof vscode.Uri 
        ? docOrUri
        : docOrUri.uri;

    let isActiveTextDocument = vscode.window.activeTextEditor && compareFsPath(uri, vscode.window.activeTextEditor.document.uri);
    return vscode.window.showTextDocument(uri, {
        ...options,
        // If the chosen document is already open, then set preview to false (which will open it in normal mode (or whatever you call it))
        // If the document is not active, then open it in preview mode
        preview: !isActiveTextDocument,
    })
}


export const getNodeNamePath = async (parentNode: OutlineNode): Promise<string> => {
    if (compareFsPath(parentNode.data.ids.uri, Extension.outlineView.rootNodes[0].data.ids.uri)) {
        return Extension.workspace.config.title;
    }
    return (await getNodeNamePath(await Extension.outlineView.getTreeElementByUri(parentNode.data.ids.parentUri) || Extension.outlineView.rootNodes[0])) + "/" + parentNode.data.ids.display;
}


export function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
    const result = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        result.push(arr.slice(i, i + chunkSize));
    }
    return result;
}

export function getDateString (): string {
    // Make a date string for the new snip aggregate
    const date = new Date();
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are zero-based
    const year = date.getFullYear();
    const dateStr = `${month}-${day}-${year}`;
    return dateStr;
}

export type RevealOptions = {
    readonly select?: boolean;
    readonly focus?: boolean;
    readonly expand?: boolean | number;
}


export async function addSingleWorkspaceEdit (edits: vscode.WorkspaceEdit, location: vscode.Location, replaceString: string): Promise<void> {
    if (location.uri.fsPath.endsWith('.wt') || location.uri.fsPath.endsWith('.md')) {
        edits.replace(location.uri, location.range, replaceString);
    }
    else if (location.uri.fsPath.endsWith('.wtnote') || location.uri.fsPath.endsWith('.config')) {
        const wtnoteDoc = await vscode.workspace.openTextDocument(location.uri);

        const text = wtnoteDoc.getText();
        const jsonContext = getJSONContext(wtnoteDoc, text, wtnoteDoc.offsetAt(location.range.start));
        if (jsonContext === null) {
            return;
        }

        // If the searched string is not the value of a key-value pair in a JSON object, or if
        //      the key is not 'text', then this result can be ignored
        // (Only want to handle name replacements if the replacement is the text value of a cell)
        const context = jsonContext;
        if (context.kind !== 'objectPropertyValue' || context.keyName !== 'text') {
            return;
        }

        edits.replace(location.uri, location.range, replaceString);
    }
}

export function escapeUserTextForRegex (text: string) {
    return text.replaceAll(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}


export function stripDiacritics (text: string): string {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");     // strip diacritics
}


export function getOrdinal(num: number): string {
    let s = ["th", "st", "nd", "rd"];
    let v = num % 100;
    return num + (s[(v - 20) % 10] || s[v] || s[0]);
}