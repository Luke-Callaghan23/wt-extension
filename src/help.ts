import * as vscode from 'vscode';
import * as extension from './extension';
import { Buff } from './Buffer/bufferSource';
import { TreeNode } from './outlineProvider/outlineTreeProvider';
import { OutlineNode } from './outline/nodes_impl/outlineNode';
import { RecyclingBinView } from './recyclingBin/recyclingBinView';
import { OutlineView } from './outline/outlineView';
import { ScratchPadView } from './scratchPad/scratchPadView';
import { Note, WorkBible } from './workBible/workBible';
import { TabLabels } from './tabLabels/tabLabels';

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