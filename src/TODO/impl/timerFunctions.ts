import * as vscode from 'vscode';
import { TODOsView } from "../TODOsView";

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
    
    this.invalidateNode(editedFragmentUri);
    this.refresh(false, []);
}

export async function disable(this: TODOsView): Promise<void> {
    return vscode.commands.executeCommand('wt.todo.refresh', true);
}