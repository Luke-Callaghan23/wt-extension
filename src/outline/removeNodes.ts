import { OutlineNode, ResourceType } from "./outlineNodes";
import * as vscode from 'vscode';
import { OutlineView } from "./outlineView";
import * as extension from '../extension';
import * as console from '../vsconsole';



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
    const uniqueRoots = await this._getLocalRoots(targets);
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
            const title = await target.shiftTrailingNodesDown(this);

            // And delete the fragment from the file system
            const removedFragmentUri = target.getUri();
            const recycleBinName = `deleted-${target.data.ids.type}-${timestamp}-${Math.random()}`;
            try {
                const newLocationUri = vscode.Uri.joinPath(extension.rootPath, `data/recycling/${recycleBinName}`);
                await vscode.workspace.fs.rename(removedFragmentUri, newLocationUri);
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error deleting fragment: ${e}`);
            }

            const logItem = {
                oldUri: removedFragmentUri.fsPath,
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
                const moveToPath = vscode.Uri.joinPath(extension.rootPath, `data/recycling/${recycleBinName}`);
                await vscode.workspace.fs.rename(removedNodeAbsPath, moveToPath);
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error deleting ${target.data.ids.type}: ${e}`);
            }

            const logItem = {
                oldUri: removedNodeAbsPath.fsPath,
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
            const clearedContainerUri = target.getUri();
            const allEntries: [ string, vscode.FileType ][] = await vscode.workspace.fs.readDirectory(clearedContainerUri);

            // Find the entries to clear and the .config file
            const clearedEntries: string[] = [];
            let dotConfig: string;
            for (const [ name, fileType ] of allEntries) {
                if (fileType === vscode.FileType.Directory) {
                    // If the entry is a folder, then it is a candidate to clear
                    clearedEntries.push(name);
                }
                else if (fileType === vscode.FileType.File && name === '.config') {
                    dotConfig = name;
                }
            }

            // Remove the .config file
            const deletedUri = vscode.Uri.joinPath(clearedContainerUri, `.config`);
            await vscode.workspace.fs.delete(deletedUri);

            for (const name of clearedEntries) {
                const recycleBinName = `deleted-${target.data.ids.type}-${timestamp}-${Math.random()}`;
                const recyclingUri = vscode.Uri.joinPath(extension.rootPath, `data/recycling/${recycleBinName}`);
                const removedNodeUri = vscode.Uri.joinPath(clearedContainerUri, name);

                // All entries in a container are folders, so remove them as dirs
                try {
                    await vscode.workspace.fs.rename(removedNodeUri, recyclingUri);
                }
                catch (e) {
                    vscode.window.showErrorMessage(`Error deleting container: ${e}`);
                }

                const logItem = {
                    oldUri: removedNodeUri.fsPath,
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
        const recyclingLogUri = vscode.Uri.joinPath(extension.rootPath, `data/recycling/.log`);

        let recyclingLog: RecycleLog[];
        try {
            const recyclingLogJSON = (await vscode.workspace.fs.readFile(recyclingLogUri)).toString();
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
            await vscode.workspace.fs.writeFile(recyclingLogUri, Buffer.from(updatedLogJSON, 'utf-8'));
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error editing recycling bin log: ${e}`);
        }
    }
    this.refresh();


}