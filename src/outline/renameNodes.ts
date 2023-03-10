/* eslint-disable curly */
import * as vscode from 'vscode';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../help';
import * as console from '../vsconsole';
import { OutlineView } from './outlineView';
import { OutlineNode } from './outlineNodes';
import * as extension from '../extension';

export async function renameResource (this: OutlineView) {

    const resource: OutlineNode = this.view.selection[0];
    const relativePath = resource.data.ids.relativePath;
    const fileName = resource.data.ids.fileName;
    const displayName = resource.data.ids.display;
    const type = resource.data.ids.type;

    const fullPath = vscode.Uri.joinPath(extension.rootPath, relativePath, fileName);
    const originalName = displayName;

    const newName = await vscode.window.showInputBox({
        placeHolder: originalName,
        prompt: `What would you like to rename ${type} '${displayName}'?`,
        ignoreFocusOut: false,
        value: originalName,
        valueSelection: [0, originalName.length]
    });

    if (!newName) {
        return;
    }

    const dotConfigRelativePath = await resource.getDotConfigPath(this);
    if (!dotConfigRelativePath) {
        vscode.window.showErrorMessage(`Unable to find configuration file for resource: '${fullPath}'`);
        return;
    }
    const dotConfigUri = vscode.Uri.joinPath(extension.rootPath, dotConfigRelativePath);

    const dotConfig = await readDotConfig(dotConfigUri);
    if (!dotConfig) return;

    // Make updates to the .config file
    let oldName: string;
    if (!dotConfig[fileName]) {
        // If there was no old name, then set the old name as the file name itself,
        //      and give it a large ordering
        oldName = fileName;
        dotConfig[fileName] = {
            title: newName,
            ordering: getLatestOrdering(dotConfig) + 1
        };
    }
    else {
        // Set the new mapping for this file's key in the config file
        // This essentially "renames" the file because the mapping is what is displayed in the 
        //		tree view
        oldName = dotConfig[fileName].title;
        dotConfig[fileName].title = newName;
    }

    // Re-write the config object to the file system
    await writeDotConfig(dotConfigUri, dotConfig);

    vscode.window.showInformationMessage(`Successfully renamed '${oldName}' to '${newName}'`);
    this.refresh();
}
