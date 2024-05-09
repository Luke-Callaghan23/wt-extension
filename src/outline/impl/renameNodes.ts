/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../../help';
import * as console from '../../vsconsole';
import { OutlineView } from '../outlineView';
import { OutlineNode, SnipNode } from '../nodes_impl/outlineNode';
import * as extension from '../../extension';
import { TabLabels } from '../../tabLabels/tabLabels';

export async function renameResource (this: OutlineView, overrideNode?: OutlineNode, overrideRename?: string) {

    const resource: OutlineNode = overrideNode || this.view.selection[0];
    const relativePath = resource.data.ids.relativePath;
    const fileName = resource.data.ids.fileName;
    const displayName = resource.data.ids.display;
    const type = resource.data.ids.type;

    const fullPath = vscode.Uri.joinPath(extension.rootPath, relativePath, fileName);
    const originalName = displayName;

    const newName = overrideRename || await vscode.window.showInputBox({
        placeHolder: originalName,
        prompt: `What would you like to rename ${type} '${displayName}'?`,
        ignoreFocusOut: false,
        value: originalName,
        valueSelection: [0, originalName.length]
    });

    if (!newName) return;

    const dotConfigUri = vscodeUris.Utils.joinPath(resource.data.ids.parentUri, '.config');
    if (!dotConfigUri) {
        vscode.window.showErrorMessage(`Unable to find configuration file for resource: '${fullPath}'`);
        return;
    }

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

    // Update internal outline tree structure's name
    resource.data.ids.display = newName;

    vscode.window.showInformationMessage(`Successfully renamed '${oldName}' to '${newName}'`);
    this.refresh(false, [resource]);
    TabLabels.assignNamesForOpenTabs();


    // IF:
    //      The renamed resource was a snip
    //      AND the snip only had one child
    //      AND the child was a fragment
    //      AND the fragment had a name pattern like 'New Fragment (#)' or 'Imported Fragment (#)'
    // Then:
    //      Ask the user if they would like to rename the child fragment along with the snip

    if (resource.data.ids.type !== 'snip') return;
    const snipContent = (resource.data as SnipNode).contents;
    if (snipContent.length !== 1) return;
    const [ content ] = snipContent;
    if (content.data.ids.type !== 'fragment') return;
    if (!(content.data.ids.display.startsWith("New Fragment (") || content.data.ids.display.startsWith("Imported Fragment ("))) return;

    const renameChild = await vscode.window.showQuickPick([ 'Yes', 'No' ], {
        canPickMany: false,
        ignoreFocusOut: false,
        placeHolder: "Yes",
        title: `Also rename child fragment '${content.data.ids.display}'?`
    });
    if (!renameChild || renameChild !== 'Yes') return;
    this.renameResource(content, newName);
}
