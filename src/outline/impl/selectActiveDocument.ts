import * as vscode from 'vscode';
import { OutlineView } from "../outlineView";
import { OutlineNode } from '../nodes_impl/outlineNode';
import { vagueNodeSearch } from '../../miscTools/help';
import { ExtensionGlobals } from '../../extension';
import { Note } from '../../notes/notes';
import { TabLabels } from '../../tabLabels/tabLabels';


// Is called whenever there is a change in the active document in vscode
// Simply selects (but does not focus) the node in the outline view that corresponds
//		to the new active document (if it exists in the outline)
export async function selectActiveDocument (this: OutlineView, editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor) return;
    if (!editor.document) return;


    // Get the node item
    const uri = editor.document.uri;
    // if (uri.toString().includes('recycling')) {
    //     return;
    // }

    const { node: nodeOrNote, source } = await vagueNodeSearch(uri);
    if (!nodeOrNote || !source) return;

    if (source !== 'notes' && nodeOrNote instanceof OutlineNode) {
        let view: vscode.TreeView<OutlineNode>;
        let node: OutlineNode = nodeOrNote;
        switch (source) {
            case 'outline': {
                view = this.view;
            } break;
            case 'recycle': {
                view = ExtensionGlobals.recyclingBinView.view;
            } break;
            case 'scratch': {
                view = ExtensionGlobals.scratchPadView.view;
            } break;
        }

        // Reveal and focus the node
        view.reveal(node as OutlineNode, {
            expand: true,
            focus: false,
            select: true
        });
    }
    else {
        const note = nodeOrNote as Note;
        ExtensionGlobals.notes.view.reveal(note, {
            expand: true,
            focus: false,
            select: true
        })
    }

    TabLabels.assignNamesForOpenTabs();
}