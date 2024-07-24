import * as extension from '../extension';
import * as vscode from 'vscode';
import { RecycleLog, ScratchPadView } from "./scratchPadView";
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from '../outline/nodes_impl/outlineNode';
import { Buff } from '../Buffer/bufferSource';
import { readDotConfig, writeDotConfig } from '../miscTools/help';

export async function deleteNodePermanently (this: ScratchPadView, targets: OutlineNode[]) {
    if (targets.length === 0) {
        return;
    }

    // Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
    const s = targets.length > 1 ? 's' : '';
    const result = await vscode.window.showInformationMessage(`Are you sure you want to delete ${targets.length} resource${s}?`, { modal: true }, "Yes", "No");
    if (!result || result === 'No') {
        return;
    }

    const rootNodeIndecesToDelete: number[] = [];
    const fileNamesRecordsToDelete: string[] = [];
    
    for (const target of targets) {
        
        // Delete the chapter or snip from the file system
        const removedNodeAbsPath = target.getUri();

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
        fileNamesRecordsToDelete.push(target.data.ids.fileName);
    }

    this.rootNodes = this.rootNodes.filter((rn, index) => {
        return !rootNodeIndecesToDelete.includes(index);
    });

    const config = await readDotConfig(ScratchPadView.scratchPadConfigUri);
    if (!config) return;
    for (const fileName of fileNamesRecordsToDelete) {
        delete config[fileName];
    }
    writeDotConfig(ScratchPadView.scratchPadConfigUri, config);

    // Refresh the whole tree as it's hard to determine what the deepest root node is
    this.refresh(false, []);
}