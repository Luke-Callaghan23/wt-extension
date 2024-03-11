/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../../help';
import * as console from '../../vsconsole';
import * as extension from '../../extension';
import { RecyclingBinView } from '../recyclingBinView';
import { OutlineNode } from '../../outline/node';

export async function renameResource (this: RecyclingBinView) {

    const resource: OutlineNode = this.view.selection[0];
    const relativePath = resource.data.ids.relativePath;
    const fileName = resource.data.ids.fileName;
    const displayName = resource.data.ids.display;
    const type = resource.data.ids.type;

    // Do not rename the dummy node
    if (type === 'fragment' && resource.data.ids.parentTypeId === 'root') {
        return;
    }

    const fullPath = vscode.Uri.joinPath(extension.rootPath, relativePath, fileName);
    const originalName = displayName;

    const newName = await vscode.window.showInputBox({
        placeHolder: originalName,
        prompt: `What would you like to rename ${type} '${displayName}'?`,
        ignoreFocusOut: false,
        value: originalName,
        valueSelection: [0, originalName.length]
    });
    if (!newName) return;

    let oldName: string;
    if (relativePath === '') {
        const log = await RecyclingBinView.readRecycleLog();
        if (!log) return null;

        const logItem = log.find(li => {
            return li.recycleBinName === fileName;
        });
        if (!logItem) {
            vscode.window.showErrorMessage(`Couldn't find log item with name ${fileName}`);
            return;
        }

        oldName = logItem.title;
        logItem.title = newName;
        RecyclingBinView.writeRecycleLog(log);
    }
    else {
        const dotConfigUri = vscodeUris.Utils.joinPath(resource.data.ids.parentUri, '.config');
        if (!dotConfigUri) {
            vscode.window.showErrorMessage(`Unable to find configuration file for resource: '${fullPath}'`);
            return;
        }
    
        const dotConfig = await readDotConfig(dotConfigUri);
        if (!dotConfig) return;
    
        // Make updates to the .config file
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
    }


    // Update internal outline tree structure's name
    resource.data.ids.display = newName;

    vscode.window.showInformationMessage(`Successfully renamed '${oldName}' to '${newName}'`);
    this.refresh(false, [resource]);
}
