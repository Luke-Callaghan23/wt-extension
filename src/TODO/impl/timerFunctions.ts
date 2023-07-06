import * as vscode from 'vscode';
import { TODOsView, todo } from "../TODOsView";
import { TODONode } from '../node';
import { initializeOutline } from '../../outlineProvider/initialize';

export async function update (
    this: TODOsView,
    editor: vscode.TextEditor
): Promise<void> {

    const document = editor.document;
    
    const editedFragmentUri: vscode.Uri = document.uri;
    const editedFragmentNode: TODONode | null = await this._getTreeElementByUri(editedFragmentUri);
    if (!editedFragmentNode) {
        this.tree = await initializeOutline((e) => new TODONode(e));
        this.refresh(this.tree);
    }

    let currentUri: vscode.Uri | undefined = editedFragmentUri;
    let currentNode: TODONode | null | undefined = editedFragmentNode;

    // Traverse upwards from the current node and invalidate it as well as all of its
    //		parents
    while (currentNode && currentUri) {
        // Invalidate the current node
        todo[currentUri.fsPath] = { type: 'invalid' };
        
        // Break once the root node's records have been removed
        if (currentNode.data.ids.type === 'root') {
            break;
        }

        // Traverse upwards
        const parentUri: vscode.Uri = currentNode.data.ids.parentUri;
        currentNode = await this._getTreeElementByUri(parentUri);
        currentUri = currentNode?.getUri();
    }

    // // Refresh all invalidated nodes on the tree
    // this.tree = await initializeOutline((e) => new TODONode(e));
    this.refresh(this.tree);
}

export async function disable(this: TODOsView): Promise<void> {
    vscode.commands.executeCommand('wt.todo.refresh', true);
}