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

export async function vagueNodeSearch (
    target: vscode.Uri,
    outlineView: OutlineView,
    recyclingBinView: RecyclingBinView,
    scratchPadView: ScratchPadView,
    workBible: WorkBible,
): Promise<{
    source: VagueSearchSource,
    node: OutlineNode | Note | null
}> {
    const relative = target.fsPath.replaceAll(extension.rootPath.fsPath, "");
        
    if (!(relative.endsWith("wt") || relative.endsWith("wtnote"))) return { node:null, source:null };
    if (relative.includes("tmp/") || relative.includes("tmp\\")) return { node:null, source:null };


    if (relative.includes("recycling")) {
        const node = await recyclingBinView.getTreeElementByUri(target);
        if (node) return {
            node: node,
            source: 'recycle'
        }
    }
    else if (relative.includes("scratchPad")) {
        const node = await scratchPadView.getTreeElementByUri(target);
        if (node) return {
            node: node,
            source: 'scratch',
        }
    }
    else if (relative.endsWith(".wtnote")) {
        const note = workBible.getNote(target);
        if (note) return {
            source: 'workBible',
            node: note
        }
    }
    else {
        const node = await outlineView.getTreeElementByUri(target)
        if (node) return {
            source: 'outline',
            node: node,
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




export async function executeGitGrep (regex: RegExp): Promise<vscode.Location[] | null>  {
    let results: string[];
    try {

        // Temporarily add all unchecked files to git (so git grep will operate on them)
        const uncheckedFiles = await new Promise<string[]>((resolve, reject) => {
            childProcess.exec(`git ls-files --others --exclude-standard`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr);
                    return;
                }
                resolve(stdout.split('\n'));
            });
        });
        
        await new Promise<void>((resolve, reject) => {
            childProcess.exec(`git add ${uncheckedFiles.join(' ')}`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => resolve());
        });

        // Perform git grep
        results = await new Promise<string[]>((resolve, reject) => {
            childProcess.exec(`git grep -i -r -H -n -E "${regex.source}"`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr);
                    return;
                }
                resolve(stdout.split('\n'));
            });
        });

        /*

        Consider doing this to stream results from git grep

        const ps = childProcess.spawn('', {
        })

        addListener(event: 'error', listener: (err: Error) => void): this;
        addListener(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
        addListener(event: 'message', listener: (message: Serializable, sendHandle: SendHandle) => void): this;
        */


        // Reset all the previously unchecked files
        await new Promise<void>((resolve, reject) => {
            childProcess.exec(`git reset ${uncheckedFiles.join(' ')}`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => resolve());
        });
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}' regex.  Error: ${err}`);
        return null;
    }

    const locations: vscode.Location[] = [];

    const parseOutput = /(?<path>.+):(?<lineOneIndexed>\d+):(?<lineContents>.+)/;
    try {
        for (const result of results) {
            const match = parseOutput.exec(result);
            if (!match || match.length === 0 || !match.groups) continue;
    
            const captureGroup = match.groups as { path: string, lineOneIndexed: string, lineContents: string };
            const { path, lineContents, lineOneIndexed } = captureGroup;
            const line = parseInt(lineOneIndexed) - 1;
    
            const parseLineReg = new RegExp(regex.source, 'ig');
            let lineMatch: RegExpExecArray | null;
            while ((lineMatch = parseLineReg.exec(lineContents)) !== null) {
                let characterStart = lineMatch.index;
                if (characterStart !== 0) {
                    characterStart += 1;
                }

                const characterEnd = characterStart + lineMatch[lineMatch.length - 1].length;
    
                const startPosition = new vscode.Position(line, characterStart);
                const endPosition = new vscode.Position(line, characterEnd);
                const foundRange = new vscode.Selection(startPosition, endPosition);
        
                const uri = vscode.Uri.joinPath(extension.rootPath, path);
                locations.push(new vscode.Location(uri, foundRange));
            }
        }

    }
    catch (err: any) {
        console.log(err);
    }
    return locations;
}