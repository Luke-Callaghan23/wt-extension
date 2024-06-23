import * as vscode from 'vscode';
import { TODOsView } from "../TODOsView";
import { TODONode } from '../node';
import { initializeOutline } from '../../outlineProvider/initialize';

export async function update (
    this: TODOsView,
    editor: vscode.TextEditor
): Promise<void> {
    const document = editor.document;
    
    const editedFragmentUri: vscode.Uri = document.uri;
    if (editedFragmentUri.fsPath.endsWith("wtnote")) return;
    if (editedFragmentUri.fsPath.includes("scratchPad")) return;
    if (editedFragmentUri.fsPath.includes("recycling")) return;
    if (editedFragmentUri.fsPath.includes("tmp/")) return;
    if (editedFragmentUri.fsPath.includes("tmp\\")) return;
    
    const editedFragmentNode: TODONode | null = await this.getTreeElementByUri(editedFragmentUri, undefined, false);
    if (!editedFragmentNode) {
        this.rootNodes = [await initializeOutline((e) => new TODONode(e), true)];
        Object.keys(TODOsView.todo).forEach(key => delete TODOsView.todo[key]);
        this.refresh(false, []);
        return;
    }

    let currentUri: vscode.Uri | undefined = editedFragmentUri;
    let currentNode: TODONode | null | undefined = editedFragmentNode;
    this.invalidateNode(currentUri, currentNode);

    // // Refresh all invalidated nodes on the tree
    // this.tree = await initializeOutline((e) => new TODONode(e));
    this.refresh(false, []);
}

export async function disable(this: TODOsView): Promise<void> {
    return vscode.commands.executeCommand('wt.todo.refresh', true);
}