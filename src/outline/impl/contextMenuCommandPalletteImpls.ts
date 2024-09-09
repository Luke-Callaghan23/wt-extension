import * as vscode from 'vscode';
import { selectFile, selectFiles } from '../../miscTools/searchFiles';
import { OutlineNode } from '../nodes_impl/outlineNode';
import * as extension from './../../extension';
import { CopiedSelection, genericPaste } from './copyPaste';
import { OutlineView } from '../outlineView';
import { setFsPathKey } from '../../miscTools/help';

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

};

export const copyPath = async () => {

};

export const deleteNode = async () => {

};

export const moveNode = async () => {

};

export const renameNode = async () => {

};