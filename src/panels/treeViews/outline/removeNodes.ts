import { OutlineNode, ResourceType } from "./outlineNodes";
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import { OutlineView } from "./outlineView";
import * as extension from '../../../extension';
import * as console from '../../../vsconsole';



// There's one thing you need to know: deleting doesn't exist
// Instead of deleting, I'm just going to move things to the recycling bin in the workspace itself
export async function removeResource (this: OutlineView, resource: OutlineNode | undefined) {
    let targets: OutlineNode[];
    if (resource) {
        targets = [resource];
    }
    else {
        targets = [...this.view.selection];
    }

    if (targets.length === 0) {
        return;
    }

    // Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
    const uniqueRoots = this._getLocalRoots(targets);
    const s = uniqueRoots.length > 1 ? 's' : '';

    const result = await vscode.window.showInformationMessage(`Are you sure you want to delete ${uniqueRoots.length} resource${s}?`, { modal: true }, "Yes", "No");
    if (result === 'No' || result === undefined) {
        return;
    }

    type RecycleLog = {
        oldUri: string,
        recycleBinName: string,
        deleteTimestamp: number,
        resourceType: ResourceType,
        title?: string,					// only used when the deleted item was a fragment
    };

    const newLogs: RecycleLog[] = [];

    for (const target of uniqueRoots) {
        const timestamp = Date.now();

        if (target.data.ids.type === 'fragment') {

            // Simply shift all the fragment that come after this one downwards
            const title = target.shiftTrailingNodesDown(this);

            // And delete the fragment from the file system
            const removedFragmentAbsPath = target.getUri();
            const recycleBinName = `deleted-${target.data.ids.type}-${timestamp}-${Math.random()}`;
            try {
                await fs.promises.rename(removedFragmentAbsPath, `${extension.rootPath}/data/recycling/${recycleBinName}`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error deleting fragment: ${e}`);
            }

            const logItem = {
                oldUri: removedFragmentAbsPath,
                deleteTimestamp: timestamp,
                title: title,
                resourceType: target.data.ids.type,
                recycleBinName: recycleBinName
            };
            newLogs.push(logItem);

        }
        else if (target.data.ids.type === 'chapter' || target.data.ids.type === 'snip') {
            // Shift all the chapters or snips that come after this one up in the order
            target.shiftTrailingNodesDown(this);

            // Delete the chapter or snip from the file system
            const removedNodeAbsPath = target.getUri();
            const recycleBinName = `deleted-${target.data.ids.type}-${timestamp}-${Math.random()}`;
            try {
                fsExtra.moveSync(removedNodeAbsPath, `${extension.rootPath}/data/recycling/${recycleBinName}`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error deleting ${target.data.ids.type}: ${e}`);
            }

            const logItem = {
                oldUri: removedNodeAbsPath,
                deleteTimestamp: timestamp,
                resourceType: target.data.ids.type,
                recycleBinName: recycleBinName
            };
            newLogs.push(logItem);

        }
        else if (target.data.ids.type === 'container') {
            // When removing items in a container, we want to clear all the directory entries in that
            //		container in the file system, but not remove the container itself
            // No need to shift items

            // Get the abs path of the container
            const clearedContainerAbsPath = target.getUri();
            const allEntries = await fs.promises.readdir(clearedContainerAbsPath, { withFileTypes: true });

            // Find the entries to clear and the .config file
            const clearedEntries: fs.Dirent[] = [];
            let dotConfig: fs.Dirent;
            for (const entry of allEntries) {
                if (entry.isDirectory()) {
                    // If the entry is a folder, then it is a candidate to clear
                    clearedEntries.push(entry);
                }
                else if (entry.isFile() && entry.name === '.config') {
                    dotConfig = entry;
                }
            }

            // Remove the .config file
            fs.rmSync(`${clearedContainerAbsPath}/.config`);

            for (const entry of clearedEntries) {
                const recycleBinName = `deleted-${target.data.ids.type}-${timestamp}-${Math.random()}`;
                const recyclingFullPath = `${extension.rootPath}/data/recycling/${recycleBinName}`;
                const removedNodeAbsPath = `${clearedContainerAbsPath}/${entry.name}`;

                // All entries in a container are folders, so remove them as dirs
                try {
                    fsExtra.moveSync(removedNodeAbsPath, recyclingFullPath);
                }
                catch (e) {
                    vscode.window.showErrorMessage(`Error deleting container: ${e}`);
                }

                const logItem = {
                    oldUri: removedNodeAbsPath,
                    deleteTimestamp: timestamp,
                    resourceType: target.data.ids.type,
                    recycleBinName: recycleBinName
                };
                newLogs.push(logItem);
            }
        }
        else if (target.data.ids.type === 'root') {
            throw new Error('Not possible');
        }

        // Read the current recycling log
        const recyclingLogAbsPath = `${extension.rootPath}/data/recycling/.log`;

        let recyclingLog: RecycleLog[];
        try {
            const recyclingLogJSON = (await fs.promises.readFile(recyclingLogAbsPath)).toString();
            if (recyclingLogJSON === '') {
                recyclingLog = [];
            }
            else {
                recyclingLog = JSON.parse(recyclingLogJSON.toString());
            }
        }
        catch(e) {
            recyclingLog = [];
        }

        const updatedLog = recyclingLog.concat(newLogs);
        const updatedLogJSON = JSON.stringify(updatedLog);

        try {
            await fs.promises.writeFile(recyclingLogAbsPath, updatedLogJSON);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error editing recycling bin log: ${e}`);
        }
    }
    this.refresh();


}