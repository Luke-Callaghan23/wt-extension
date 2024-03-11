import * as extension from '../../extension';
import * as vscode from 'vscode';
import { RecycleLog, RecyclingBinView } from "../recyclingBinView";
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from '../../outline/node';
import { Buff } from '../../Buffer/bufferSource';
import { writeDotConfig } from '../../help';

export async function deleteNodePermanently (this: RecyclingBinView, targets: OutlineNode[]) {
    // Do not delete the dummy node
    targets = targets.filter(ur => {
        return !(ur.data.ids.type === 'fragment' && ur.data.ids.parentTypeId === 'root');
    });
    
    if (targets.length === 0) {
        return;
    }

    // Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
    const uniqueRootsRaw = await this.getLocalRoots(targets);
    const uniqueRoots = uniqueRootsRaw
    const s = uniqueRoots.length > 1 ? 's' : '';

    const result = await vscode.window.showInformationMessage(`Are you sure you want to delete ${uniqueRoots.length} resource${s}?`, { modal: true }, "Yes", "No");
    if (result === 'No' || result === undefined) {
        return;
    }

    const rootNodeIndecesToDelete: number[] = [];
    const logNodeNodeFileNamesToDelete: string[] = [];
    
    let updateRoot = false;
    const containers: OutlineNode[] = [];
    for (const target of uniqueRoots) {
        
        // Delete the chapter or snip from the file system
        const removedNodeAbsPath = target.getUri();

        if (target.data.ids.relativePath === '') {
            try {
                await vscode.workspace.fs.delete(removedNodeAbsPath, {
                    recursive: true,
                    useTrash: false,
                });
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error deleting ${target.data.ids.type}: ${e}`);
            }

            const removeViewIndex = this.rootNodes.findIndex(li => {
                return li.data.ids.fileName === target.data.ids.fileName;
            });
            if (removeViewIndex === -1) continue;
            rootNodeIndecesToDelete.push(removeViewIndex);
            logNodeNodeFileNamesToDelete.push(target.data.ids.fileName);
            // this.rootNodes.splice(removeViewIndex, 1);

            // const log = await RecyclingBinView.readRecycleLog();
            // if (!log) continue;
            // const removeLogIndex = log.findIndex(li => li.recycleBinName === target.data.ids.fileName);
            // if (removeLogIndex === -1) continue;
            // log.splice(removeLogIndex, 1);

            // RecyclingBinView.writeRecycleLog(log);

            updateRoot = true;
        }
        else if (target.data.ids.type === 'fragment') {
            target.shiftTrailingNodesDown(this);
            try {
                await vscode.workspace.fs.delete(removedNodeAbsPath, {
                    recursive: true,
                    useTrash: false,
                });
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error deleting ${target.data.ids.type}: ${e}`);
            }

            // Finally, remove the fragment from the parent's text node container
            const fragmentParentUri = target.data.ids.parentUri;
            const fragmentParent: OutlineNode = await this.getTreeElementByUri(fragmentParentUri);
            if (!fragmentParent) continue;

            containers.push(fragmentParent);

            // Find the index of the target fragment
            const fragmentParentTextNodes = (fragmentParent.data as ChapterNode | SnipNode).textData;
            const targetFragUriStr = removedNodeAbsPath.toString();
            const targetFragmentIndex = fragmentParentTextNodes.findIndex(frag => frag.data.ids.uri.toString() === targetFragUriStr);
            if (targetFragmentIndex === -1) continue;

            // Splice that fragment away
            fragmentParentTextNodes.splice(targetFragmentIndex, 1);
        }
        else if (target.data.ids.type === 'chapter' || target.data.ids.type === 'snip') {
            target.shiftTrailingNodesDown(this);
            try {
                await vscode.workspace.fs.delete(removedNodeAbsPath, {
                    recursive: true,
                    useTrash: false,
                });
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error deleting ${target.data.ids.type}: ${e}`);
            }

            // Finally, remove the chapter or snip from the parent container
            const removedNodeParentUri = target.data.ids.parentUri;
            const removedNodeParent: OutlineNode = await this.getTreeElementByUri(removedNodeParentUri);
            if (!removedNodeParent) continue;

            containers.push(removedNodeParent);

            // Find the index of the target fragment
            const nodeParentContents = (removedNodeParent.data as ContainerNode).contents;
            const targetNodeUriStr = target.getUri().toString();
            const targetNodeIndex = nodeParentContents.findIndex(node => node.data.ids.uri.toString() === targetNodeUriStr);
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
                const removedNodeUri = vscode.Uri.joinPath(clearedContainerUri, name);

                // All entries in a container are folders, so remove them as dirs
                try {
                    await vscode.workspace.fs.delete(removedNodeUri, {
                        recursive: true,
                        useTrash: false,
                    });
                }
                catch (e) {
                    vscode.window.showErrorMessage(`Error deleting container: ${e}`);
                }
            }

            // Instead of removing the container from the parent's content object structure as we do in the other
            //      two cases above, here we don't actually delete the container, we just clear the contents of the
            //      targeted container itself
            (target.data as ContainerNode).contents = [];
            containers.push(target);
        }

    }


    this.rootNodes = this.rootNodes.filter((rn, index) => {
        return !rootNodeIndecesToDelete.includes(index);
    });

    const log = await RecyclingBinView.readRecycleLog();
    if (!log) return;
    
    const newLog = log.filter((li) => {
        return !logNodeNodeFileNamesToDelete.includes(li.recycleBinName);
    });
    await RecyclingBinView.writeRecycleLog(newLog);

    // Refresh the whole tree as it's hard to determine what the deepest root node is
    this.refresh(false, updateRoot ? [] : containers);
}