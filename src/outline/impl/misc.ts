import { OutlineNode } from "../nodes_impl/outlineNode";
import * as vscode from 'vscode';
import * as extension from './../../extension';
import { selectFile } from "../../miscTools/searchFiles";


export function copyRelativePath (resource: OutlineNode) {
    vscode.env.clipboard.writeText(resource.data.ids.uri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/'));
    vscode.window.showInformationMessage(`[INFO] Successfully copied relative path for '${resource.data.ids.display}'`);
}

export function copyPath (resource: OutlineNode) {
    vscode.env.clipboard.writeText(resource.data.ids.uri.fsPath);
    vscode.window.showInformationMessage(`[INFO] Successfully copied path for '${resource.data.ids.display}'`);
}

export async function manualMove (resource: OutlineNode) {
    const chose = await selectFile([ (node) => {
        return node.data.ids.type !== 'fragment'
    } ]);
    if (chose === null) return;
    if (chose.data.ids.type === 'root') return;
    
    const moveResult = await resource.generalMoveNode("move", chose, extension.ExtensionGlobals.recyclingBinView, extension.ExtensionGlobals.outlineView, 0, null, "Insert");
    if (moveResult.moveOffset === -1) return;
    const effectedContainers = moveResult.effectedContainers;
    const outline =  extension.ExtensionGlobals.outlineView;
    return outline.refresh(false, effectedContainers);
}