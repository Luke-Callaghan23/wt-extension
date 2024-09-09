import * as vscode from 'vscode';
import { selectFile, selectFiles } from '../../miscTools/searchFiles';
import { OutlineNode } from '../nodes_impl/outlineNode';
import * as extension from './../../extension';
import { genericPaste } from './copyPaste';
import * as misc from './misc';

export const copyNode = async () => {
    const result = await selectFiles();
    if (result === null) {
        return;
    }
    const nodes = result as readonly OutlineNode[];
    return extension.ExtensionGlobals.outlineView.copy(nodes);
};

export const pasteNode = async () => {
    const result = await selectFiles();
    if (result === null) {
        return null;
    }
    const destinations = result;
    return genericPaste(destinations);
};

export const duplicateNode = async () => {
    const result = await selectFiles();
    if (result === null) {
        return null;
    }
    const destinations = result;
    const outlineView = extension.ExtensionGlobals.outlineView;
    for (const dest of destinations) {
        await outlineView.copy([dest] as readonly OutlineNode[]);

        const parentUri = dest.getParentUri();
        const parentNode = await outlineView.getTreeElementByUri(parentUri);
        if (parentNode !== null) {
            await genericPaste([parentNode]);
        }
    }
};

export const copyRelativePath = async () => {
    const result = await selectFile();
    if (result === null) {
        return null;
    }
    misc.copyRelativePath(result);
};

export const copyPath = async () => {
    const result = await selectFile();
    if (result === null) {
        return null;
    }
    misc.copyPath(result);
};

export const deleteNode = async () => {
    const result = await selectFiles();
    if (result === null) {
        return null;
    }
    const deletes = result;
    return extension.ExtensionGlobals.outlineView.removeResource(deletes);
};

export const moveNode = async () => {
    const result = await selectFile();
    if (result === null) {
        return null;
    }
    return misc.manualMove(result);
};

export const renameNode = async () => {
    const result = await selectFile();
    if (result === null) {
        return null;
    }
    const renamer = result;
    return extension.ExtensionGlobals.outlineView.renameResource(renamer);
};