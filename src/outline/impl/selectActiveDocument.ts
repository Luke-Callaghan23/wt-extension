import * as vscode from 'vscode';
import { OutlineView } from "../outlineView";
import { OutlineNode } from '../nodes_impl/outlineNode';
import { vagueNodeSearch } from '../../miscTools/help';
import { ExtensionGlobals } from '../../extension';
import { NotebookPanelNote } from '../../notebook/notebookPanel';
import { TabLabels } from '../../tabLabels/tabLabels';
import { UriBasedView } from '../../outlineProvider/UriBasedView';


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

    if (source !== 'notebook' && nodeOrNote instanceof OutlineNode) {
        let view: UriBasedView<OutlineNode>;
        let node: OutlineNode = nodeOrNote;
        switch (source) {
            case 'outline': {
                view = this;
            } break;
            case 'recycle': {
                view = ExtensionGlobals.recyclingBinView;
            } break;
            case 'scratch': {
                view = ExtensionGlobals.scratchPadView;
            } break;
        }

        // Reveal and focus the node
        view.expandAndRevealOutlineNode(node as OutlineNode, {
            expand: true,
            focus: false,
            select: true
        });
    }
    else {
        const note = nodeOrNote as NotebookPanelNote;
        ExtensionGlobals.notebookPanel.view.reveal(note, {
            expand: true,
            focus: false,
            select: true
        })
    }

    TabLabels.assignNamesForOpenTabs();
}