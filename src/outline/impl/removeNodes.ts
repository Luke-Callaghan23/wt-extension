import { ChapterNode, ContainerNode, OutlineNode, ResourceType, SnipNode } from "../nodes_impl/outlineNode";
import * as vscode from 'vscode';
import { OutlineView } from "../outlineView";
import * as extension from '../../extension';
import * as console from '../../miscTools/vsconsole';
import { Buff } from "../../Buffer/bufferSource";
import { compareFsPath, getSectionedProgressReporter, progressOnViews, writeDotConfig } from "../../miscTools/help";
import { RecycleLog, RecyclingBinView } from "../../recyclingBin/recyclingBinView";
import { TabLabels } from "../../tabLabels/tabLabels";

export function getUsableDeleteFileName (type: ResourceType, wt?: boolean) {
    const useWt = wt !== undefined && wt === true;
    const wtStr = useWt ? '.wt' : '';
    const timestamp = Date.now();
    return `deleted-${type}-${timestamp}-${parseInt(Math.random() * 10000 + '')}${wtStr}`
}

async function shouldPermanentlyDelete(target: OutlineNode) {
    if (target.data.ids.type !== 'fragment') {
        return false;
    }
    if (!target.data.ids.display.startsWith('New Fragment') && !target.data.ids.display.includes('Imported Fragment')) {
        return false;
    }

    const stat = await vscode.workspace.fs.stat(target.data.ids.uri);
    if (stat.size !== 0) {
        return false;
    }

    return true;
}

// There's one thing you need to know: deleting doesn't exist
// Instead of deleting, I'm just going to move things to the recycling bin in the workspace itself
export async function removeResource (this: OutlineView, targets: OutlineNode[]) {
    // Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
    const uniqueRoots = await this.getLocalRoots(targets);
    
    const permantlyDelete: [ boolean, OutlineNode ][]  = await Promise.all(
        targets.map(target => 
            shouldPermanentlyDelete(target)
            .then(should => [ should, target ])
        )
    ) as [ boolean, OutlineNode ][];

    const permanentlyDeleteMap = Object.fromEntries(permantlyDelete.map(([ should, target ]) => {
        return [ target.data.ids.uri.fsPath, should ];
    }));

    const s = uniqueRoots.length > 1 ? 's' : '';

    let deletingAll = false;

    const everythingPermanentlyDeleteable = permantlyDelete.every(([ should, _ ]) => should);
    if (everythingPermanentlyDeleteable) {
        const result = await vscode.window.showInformationMessage(
            `Would you like to permantly delete ${uniqueRoots.length} empty fragment file${s}?`, 
            { modal: true }, 
            "Yes", "Move to Recycling", "Cancel"
        );
        
        if (!result || result === 'Cancel') {
            return;
        }
        deletingAll = result === 'Yes';
    }
    else {
        const result = await vscode.window.showInformationMessage(`Are you sure you want to move ${uniqueRoots.length} resource${s} to the recycling bin?`, { modal: true }, "Yes", "No");
        if (result === 'No' || result === undefined) {
            return;
        }
    }

    const newLogs: RecycleLog[] = [];
    const containers: OutlineNode[] = [];
    await progressOnViews([ OutlineView.viewId, RecyclingBinView.viewId ], `Removing Files From Outline`, async (progress) => {
        const reporter = getSectionedProgressReporter (
            uniqueRoots.map((_, index) => index.toString()), 
            progress
        );
        
        for (const target of uniqueRoots) {
            reporter(`Removing '${target.data.ids.display}'`);
            const timestamp = Date.now();

            if (target.data.ids.type === 'fragment') {

                // Simply shift all the fragment that come after this one downwards
                const title = await target.shiftTrailingNodesDown(this);

                // And delete the fragment from the file system
                const removedFragmentUri = target.getUri();

                let moveToRecycling = true;
                if (permanentlyDeleteMap[target.data.ids.uri.fsPath] === true) {
                    if (!everythingPermanentlyDeleteable) {
                        const result = await vscode.window.showInformationMessage(
                            `Fragment '${target.data.ids.display}' is empty and has a default name, would you like to permanently delete it?`, 
                            { modal: true }, 
                            "Yes", "Move to Recycling"
                        );
                        if (result === 'Yes') {
                            moveToRecycling = false;
                            await vscode.workspace.fs.delete(target.data.ids.uri);
                        }
                    }
                    else if (deletingAll) {
                        moveToRecycling = false;
                        await vscode.workspace.fs.delete(target.data.ids.uri);
                    }
                }

                if (moveToRecycling) {
                    const recycleBinName = getUsableDeleteFileName(target.data.ids.type, true);
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

                // Finally, remove the fragment from the parent's text node container
                const fragmentParentUri = target.data.ids.parentUri;
                const fragmentParent: OutlineNode = await this.getTreeElementByUri(fragmentParentUri)! as OutlineNode;
                if (!fragmentParent) continue;

                containers.push(fragmentParent);

                // Find the index of the target fragment
                let fragmentParentTextNodes;
                if (fragmentParent.data.ids.type === 'chapter') {
                    fragmentParentTextNodes = (fragmentParent.data as ChapterNode).textData;
                }
                else if (fragmentParent.data.ids.type === 'snip') {
                    fragmentParentTextNodes = (fragmentParent.data as SnipNode).contents;
                }
                else throw `unsupported parent type ${fragmentParent.data.ids.type}`;
                
                const targetFragmentIndex = fragmentParentTextNodes.findIndex(frag => compareFsPath(frag.data.ids.uri, removedFragmentUri));
                if (targetFragmentIndex === -1) continue;

                // Splice that fragment away
                fragmentParentTextNodes.splice(targetFragmentIndex, 1);
            }
            else if (target.data.ids.type === 'chapter' || target.data.ids.type === 'snip') {
                // Shift all the chapters or snips that come after this one up in the order
                await target.shiftTrailingNodesDown(this);

                // Delete the chapter or snip from the file system
                const removedNodeAbsPath = target.getUri();
                const recycleBinName = getUsableDeleteFileName(target.data.ids.type);
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
                    recycleBinName: recycleBinName,
                    title: target.data.ids.display
                };
                newLogs.push(logItem);

                // Finally, remove the chapter or snip from the parent container
                const removedNodeParentUri = target.data.ids.parentUri;
                const removedNodeParent: OutlineNode = await this.getTreeElementByUri(removedNodeParentUri)! as OutlineNode;
                if (!removedNodeParent) continue;

                containers.push(removedNodeParent);

                // Find the index of the target fragment
                const nodeParentContents = (removedNodeParent.data as ContainerNode).contents;
                const targetNodeIndex = nodeParentContents.findIndex(node => compareFsPath(node.data.ids.uri, target.getUri()));
                if (targetNodeIndex === -1) continue;

                // Splice that fragment away
                nodeParentContents.splice(targetNodeIndex, 1);
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
                writeDotConfig(deletedUri, {});

                for (const name of clearedEntries) {
                    const recycleBinName = getUsableDeleteFileName(target.data.ids.type);
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
                        recycleBinName: recycleBinName,
                        title: target.data.ids.display
                    };
                    newLogs.push(logItem);
                }

                // Instead of removing the container from the parent's content object structure as we do in the other
                //      two cases above, here we don't actually delete the container, we just clear the contents of the
                //      targeted container itself
                (target.data as ContainerNode).contents = [];

                containers.push(target);
            }
            else if (target.data.ids.type === 'root') {
                throw new Error('Not possible');
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    });
    
    // Read the current recycling log
    const recyclingLogUri = vscode.Uri.joinPath(extension.rootPath, `data/recycling/.log`);

    let recyclingLog: RecycleLog[];
    try {
        const recyclingLogJSON = extension.decoder.decode(await vscode.workspace.fs.readFile(recyclingLogUri));
        if (recyclingLogJSON === '') {
            recyclingLog = [];
        }
        else {
            recyclingLog = JSON.parse(recyclingLogJSON);
        }
    }
    catch(e) {
        recyclingLog = [];
    }

    const updatedLog = recyclingLog.concat(newLogs);
    const updatedLogJSON = JSON.stringify(updatedLog);

    try {
        await vscode.workspace.fs.writeFile(recyclingLogUri, Buff.from(updatedLogJSON, 'utf-8'));
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error editing recycling bin log: ${e}`);
    }
    // Refresh the whole tree as it's hard to determine what the deepest root node is
    this.refresh(false, containers);
    vscode.commands.executeCommand("wt.recyclingBin.refresh");

    setTimeout(() => {
        // Reassign names in case if any of the opened fragments have just been deleted
        TabLabels.assignNamesForOpenTabs();
    }, 1000);  
}