import * as vscode from 'vscode';
import { OutlineView } from "../outlineView";
import { OutlineNode } from '../node';


// Is called whenever there is a change in the active document in vscode
// Simply selects (but does not focus) the node in the outline view that corresponds
//		to the new active document (if it exists in the outline)
export async function selectActiveDocument (this: OutlineView, editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor) return;
    if (!editor.document) return;

    // Get the node item
    const uri = editor.document.uri;
    const node = await this._getTreeElementByUri(uri);
    if (!node) return;

    // Reveal and focus the node
    this.view.reveal(node as OutlineNode, {
        expand: true,
        focus: false,
        select: true
    });
}