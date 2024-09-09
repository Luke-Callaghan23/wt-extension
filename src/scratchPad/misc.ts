import * as vscode from 'vscode';
import { selectFile } from "../miscTools/searchFiles";
import { OutlineNode } from "../outline/nodes_impl/outlineNode";
import * as extension from './../extension';


export async function selectScratchPadItems (): Promise<OutlineNode[] | null> {
    return selectScratchPadItem_impl(true);
}

export async function selectScratchPadItem (): Promise<OutlineNode | null> {
    const result = await selectScratchPadItem_impl(false);
    if (result === null) {
        return null;
    }
    return result[0];
}


async function selectScratchPadItem_impl (canPickMany: boolean): Promise<OutlineNode[] | null> {
    const scratchPad = extension.ExtensionGlobals.scratchPadView;

    interface ScratchPadItem extends vscode.QuickPickItem {
        label: string;
        node: OutlineNode;
    }
    const spi: ScratchPadItem[] = scratchPad.rootNodes.map(node => ({
        label: `$(edit) ${node.data.ids.display}`,
        node: node,
    }));

    let scratchPadItems: ScratchPadItem[];
    if (canPickMany) {
        const res = await vscode.window.showQuickPick(spi, {
            canPickMany: true,
            ignoreFocusOut: false,
            title: "Select a scratch pad item"
        });
        if (!res) return null;
        scratchPadItems = res;
    }
    else {
        const res = await vscode.window.showQuickPick(spi, {
            canPickMany: false,
            ignoreFocusOut: false,
            title: "Select a scratch pad item"
        });
        if (!res) return null;
        scratchPadItems = [res];
    }
    return scratchPadItems.map(item => item.node);

}

export async function manualMove (resource: OutlineNode) {
    const chose = await selectFile([ (node) => {
        return node.data.ids.type !== 'fragment'
    } ]);
    if (chose === null) return;
    if (chose.data.ids.type === 'root') return;
    
    const moveResult = await resource.generalMoveNode("scratch", chose, extension.ExtensionGlobals.recyclingBinView, extension.ExtensionGlobals.outlineView, 0, null, "Insert");
    if (moveResult.moveOffset === -1) return;
    const effectedContainers = moveResult.effectedContainers;
    const outline =  extension.ExtensionGlobals.outlineView;
    return Promise.all([
        outline.refresh(false, effectedContainers),
        extension.ExtensionGlobals.scratchPadView.refresh(true, []),
    ]);
}