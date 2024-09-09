import * as extension from './../extension';
import * as vscode from 'vscode';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import * as misc from './misc';

export async function deleteNode () {
    const deletes = await misc.selectScratchPadItems();
    if (deletes === null) {
        return null;
    }
    return extension.ExtensionGlobals.scratchPadView.deleteNodePermanently(deletes);
}

export async function renameNode () {
    const renamer = await misc.selectScratchPadItem();
    if (renamer === null) {
        return null;
    }
    return extension.ExtensionGlobals.scratchPadView.renameResource(renamer);
}

export async function moveNode () {
    const mover = await misc.selectScratchPadItem();
    if (mover === null) {
        return null;
    }
    return misc.manualMove(mover);
}


