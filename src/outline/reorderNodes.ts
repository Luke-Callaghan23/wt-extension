/* eslint-disable curly */
import * as vscode from 'vscode';
import { ConfigFileInfo, ConfigFileInfoExpanded, readDotConfig, writeDotConfig } from "../help";
import { OutlineNode } from "./outlineNodes";
import { OutlineView } from "./outlineView";
import * as extension from '../extension';
import { RootNode } from './outlineNodes';
import * as console from '../vsconsole';


enum ReorderDirection {
	up, down
}

// Flow of moving items up is to collect config file from the file system info into a single object, 
//		re order them, then unpackage them back into the file system
// Because unpacking and re-packing into the file system is different for each different node type
//		but everything else is the same, I broke the main re-ordering into a separate function
async function reorderUp (
    dotConfig: { [index: string]: ConfigFileInfo },
    targets:  OutlineNode[]
): Promise<ConfigFileInfoExpanded[]> { 
    const allNodes = Object.getOwnPropertyNames(dotConfig).filter(dc => dc !== 'self');
    allNodes.sort((a, b) => dotConfig[a].ordering - dotConfig[b].ordering);

    // Convert standard file info format into ConfigFileInfoExpanded array
    const targetsConfigInfo: ConfigFileInfoExpanded[] = [];
    targets.forEach(target => targetsConfigInfo.push({ ...dotConfig[target.data.ids.fileName], fileName: target.data.ids.fileName }));

    const sortedTargetsConfigInfo = targetsConfigInfo;
    sortedTargetsConfigInfo.sort((a, b) => a.ordering - b.ordering);

    // Re order the "moving" nodes
    // The moving nodes are all the nodes that are selected
    let lastPosition = sortedTargetsConfigInfo[0].ordering - 1;
    if (lastPosition < 0) {
        lastPosition = 0;
    }
    const newOrdering: ConfigFileInfoExpanded[] = sortedTargetsConfigInfo.map(({ ordering, title, fileName }) => {
        const newTarget = {
            title: title,
            ordering: lastPosition,
            fileName: fileName
        };
        lastPosition++;
        return newTarget;
    });

    const earliestNewOrdering = newOrdering[0].ordering;
    const latestNewOrdering = newOrdering[newOrdering.length - 1].ordering;

    // Collect all the nodes that come before the re-ordered nodes and all the ones that come
    //		after into separate lists
    const beforeEarliestInReorder: ConfigFileInfoExpanded[] = [];
    const afterLatestInReorder: ConfigFileInfoExpanded[] = [];
    Object.getOwnPropertyNames(dotConfig).forEach(fileName => {
        if (fileName === 'self') { 
            return;
        }
        if (targets.find(target => target.data.ids.fileName === fileName)) {
            return;
        }
        const configFileInfo = dotConfig[fileName];
        if (configFileInfo.ordering < earliestNewOrdering) {
            beforeEarliestInReorder.push({ ...configFileInfo, fileName: fileName });
        }
        else {
            afterLatestInReorder.push({ ...configFileInfo, fileName: fileName });
        }
    });
    
    // Re-number all the nodes that come after the re-order

    // First sort
    const afterLatestInReorderSorted = afterLatestInReorder;
    afterLatestInReorderSorted.sort((a, b) => a.ordering - b.ordering);

    // Iterate over each and assign a new number
    lastPosition = latestNewOrdering;
    afterLatestInReorderSorted.forEach(target => {
        lastPosition += 1;
        target.ordering = lastPosition;
    });
    

    const selfNode: any = dotConfig['self'];
    if (selfNode) {
        selfNode.fileName = 'self';
        const self: ConfigFileInfoExpanded = selfNode;
        return [self, ...beforeEarliestInReorder, ...newOrdering, ...afterLatestInReorderSorted];
    }
    else {
        return [...beforeEarliestInReorder, ...newOrdering, ...afterLatestInReorderSorted];
    }
    
}

async function reorderDown (
    dotConfig: { [index: string]: ConfigFileInfo },
    targets: OutlineNode[]
): Promise<ConfigFileInfoExpanded[]> {
    const allNodes = Object.getOwnPropertyNames(dotConfig).filter(dc => dc !== 'self');
    allNodes.sort((a, b) => dotConfig[a].ordering - dotConfig[b].ordering);

    const targetsConfigInfo: ConfigFileInfoExpanded[] = [];
    targets.forEach(target => targetsConfigInfo.push({ ...dotConfig[target.data.ids.fileName], fileName: target.data.ids.fileName }));

    const sortedTargetsConfigInfo = targetsConfigInfo;
    sortedTargetsConfigInfo.sort((a, b) => b.ordering - a.ordering);

    let lastPosition = sortedTargetsConfigInfo[0].ordering + 1;
    const newOrdering: ConfigFileInfoExpanded[] = sortedTargetsConfigInfo.map(({ ordering, title, fileName }) => {
        const newTarget = {
            title: title,
            ordering: lastPosition,
            fileName: fileName
        };
        lastPosition--;
        return newTarget;
    });

    const earliestNewOrdering = newOrdering[newOrdering.length - 1].ordering;
    const latestNewOrdering = newOrdering[0].ordering;

    // Collect all the nodes that come before the re-ordered nodes and all the ones that come
    //		after into separate lists
    const afterEarliestInReorder: ConfigFileInfoExpanded[] = [];
    const beforeLatesttInReorder: ConfigFileInfoExpanded[] = [];
    Object.getOwnPropertyNames(dotConfig).forEach(fileName => {
        if (fileName === 'self') { 
            return;
        }
        if (targets.find(target => target.data.ids.fileName === fileName)) {
            return;
        }
        const configFileInfo = dotConfig[fileName];
        if (configFileInfo.ordering > latestNewOrdering) {
            afterEarliestInReorder.push({ ...configFileInfo, fileName: fileName });
        }
        else {
            beforeLatesttInReorder.push({ ...configFileInfo, fileName: fileName });
        }
    });
    
    // Re-number all the nodes that come after the re-order

    // First sort
    const beforeLatestInReorderSorted = beforeLatesttInReorder;
    beforeLatestInReorderSorted.sort((a, b) => a.ordering - b.ordering);

    
    // Iterate over each and assign a new number
    lastPosition = latestNewOrdering;
    beforeLatestInReorderSorted.reverse().forEach(target => {
        lastPosition -= 1;
        target.ordering = lastPosition;
    });


    const selfNode: any = dotConfig['self'];
    if (selfNode) {
        selfNode.fileName = 'self';
        const self: ConfigFileInfoExpanded = selfNode;
        return [self, ...afterEarliestInReorder, ...newOrdering, ...beforeLatestInReorderSorted];
    }
    else {
        return [...afterEarliestInReorder, ...newOrdering, ...beforeLatestInReorderSorted];
    }
}

export async function moveUp (this: OutlineView, resource: OutlineNode | undefined) {
    if (!resource) {
        return;
    }

    // Get the moving nodes array
    let prelimTargets: OutlineNode[];
    if (!this.view.selection) {
        // Favor `view.selection` over `resource`
        prelimTargets = [resource];
    }
    else {
        prelimTargets = [...this.view.selection];
    }

    // Of all the possible moving nodes, only move those who have the same parent node as the node that was clicked
    const targets = prelimTargets.filter(target => {
        return target.data.ids.parentInternalId === resource.data.ids.parentInternalId;
    });
    

    if (!targets.find(target => target.data.ids.internal === resource.data.ids.internal)) {
        targets.push(resource);
    }
    
    // Get the path of the .config file for the moving nodes
    const dotConfigRelativePath = await resource.getDotConfigPath(this);
    if (!dotConfigRelativePath) return;
    const dotConfigUri = vscode.Uri.joinPath(extension.rootPath, dotConfigRelativePath);

    // Read .config from disk
    const dotConfig = await readDotConfig(dotConfigUri);
    if (!dotConfig) return;
    
    // Re order the nodes
    const reOrderedNodes = await reorderUp(dotConfig, targets);

    // Re format the array of ConfigFileInfoExpandeds into a single object { string -> ConfigFileInfo }
    const reFormated: { [index: string]: ConfigFileInfo } = {};
    reOrderedNodes.forEach(({ fileName, ordering, title }) => {
        reFormated[fileName] = { ordering, title };
    });

    // Write the re formated .config file
    await writeDotConfig(dotConfigUri, reFormated);
    await this.refresh();
    this.view.reveal((this.tree.data as RootNode).chapters, { focus: false, select: true });
}

export async function moveDown (this: OutlineView, resource: any) {
    if (!resource) {
        return;
    }

    // Get the moving nodes array
    let prelimTargets: OutlineNode[];
    if (!this.view.selection) {
        // Favor `view.selection` over `resource`
        prelimTargets = [resource];
    }
    else {
        prelimTargets = [...this.view.selection];
    }

    // Of all the possible moving nodes, only move those who have the same parent node as the node that was clicked
    const targets = prelimTargets.filter(target => {
        return target.data.ids.parentInternalId === resource.data.ids.parentInternalId;
    });

    if (!targets.find(target => target.data.ids.internal === resource.data.ids.internal)) {
        targets.push(resource);
    }

    // Get the path of the .config file for the moving nodes
    const dotConfigRelativePath = await resource.getDotConfigPath(this);
    if (!dotConfigRelativePath) return;
    const dotConfigUri = vscode.Uri.joinPath(extension.rootPath, dotConfigRelativePath);

    // Read .config from disk
    const dotConfig = await readDotConfig(dotConfigUri);
    if (!dotConfig) return;
    
    // Re order the nodes
    const reOrderedNodes = await reorderDown(dotConfig, targets);

    // Re format the array of ConfigFileInfoExpandeds into a single object { string -> ConfigFileInfo }
    const reFormated: { [index: string]: ConfigFileInfo } = {};
    reOrderedNodes.forEach(({ fileName, ordering, title }) => {
        reFormated[fileName] = { ordering, title };
    });

    // Write the re formated .config file
    await writeDotConfig(dotConfigUri, reFormated);
    await this.refresh();
    this.view.reveal((this.tree.data as RootNode).chapters, { focus: true, select: true });
}