/* eslint-disable curly */
import * as vscode from 'vscode';
import { ConfigFileInfo, ConfigFileInfoExpanded, readDotConfig, writeDotConfig } from "../help";
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from "./outlineNodes";
import { OutlineView } from "./outlineView";
import * as extension from '../extension';
import { RootNode } from './outlineNodes';
import * as console from '../vsconsole';


// Flow of moving items up is to collect config file from the file system info into a single object, 
//		re order them, then unpackage them back into the file system
// Because unpacking and re-packing into the file system is different for each different node type
//		but everything else is the same, I broke the main re-ordering into a separate function
async function reorderUp (
    dotConfig: ConfigFileInfoExpanded[],
    targets:  OutlineNode[]
): Promise<ConfigFileInfoExpanded[]> { 
    const sortedTargetsConfigInfo = dotConfig;
    sortedTargetsConfigInfo.sort((a, b) => a.ordering - b.ordering);

    // Re order the "moving" nodes
    // The moving nodes are all the nodes that are selected
    let lastPosition = sortedTargetsConfigInfo[0].ordering - 1;
    if (lastPosition < 0) {
        lastPosition = 0;
    }
    const newOrdering: ConfigFileInfoExpanded[] = sortedTargetsConfigInfo.map(({ ordering, title, fileName, node }) => {
        const newTarget = {
            title: title,
            ordering: lastPosition,
            fileName: fileName,
            node: node
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
    dotConfig.forEach((configFileInfo) => {
        const fileName = configFileInfo.fileName;
        if (fileName === 'self') { 
            return;
        }
        if (targets.find(target => target.data.ids.fileName === fileName)) {
            return;
        }
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

    return [...beforeEarliestInReorder, ...newOrdering, ...afterLatestInReorderSorted];
}

async function reorderDown (
    dotConfig: ConfigFileInfoExpanded[],
    targets: OutlineNode[]
): Promise<ConfigFileInfoExpanded[]> {

    const sortedTargetsConfigInfo = dotConfig;
    sortedTargetsConfigInfo.sort((a, b) => a.ordering - b.ordering);

    let lastPosition = sortedTargetsConfigInfo[0].ordering + 1;
    const newOrdering: ConfigFileInfoExpanded[] = sortedTargetsConfigInfo.map(({ ordering, title, fileName, node }) => {
        const newTarget = {
            title: title,
            ordering: lastPosition,
            fileName: fileName,
            node: node
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
    dotConfig.forEach((configFileInfo) => {
        const fileName = configFileInfo.fileName;
        if (fileName === 'self') { 
            return;
        }
        if (targets.find(target => target.data.ids.fileName === fileName)) {
            return;
        }

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

    return [...afterEarliestInReorder, ...newOrdering, ...beforeLatestInReorderSorted];
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
        return target.data.ids.parentUri.toString() === resource.data.ids.parentUri.toString();
    });
    

    if (!targets.find(target => target.data.ids.uri.toString() === resource.data.ids.uri.toString())) {
        targets.push(resource);
    }
    
    // Get the path of the .config file for the moving nodes
    const dotConfigUri = await resource.getDotConfigPath();
    if (!dotConfigUri) return;

    // Read .config from disk
    const dotConfig = await readDotConfig(dotConfigUri);
    if (!dotConfig) return;

    
    const parentNode = (await this._getTreeElementByUri(resource.data.ids.parentUri)) as OutlineNode;

    // Find the unordered list from the parent node based on the mover type
    let container: OutlineNode[];
    if (resource.data.ids.type === 'chapter') {
        container = (parentNode.data as ContainerNode).contents;
    }
    else if (resource.data.ids.type === 'fragment') {
        container = (parentNode.data as SnipNode | ChapterNode).textData;
    }
    else if (resource.data.ids.type === 'snip') {
        container = (parentNode.data as ContainerNode).contents;
    }
    else {
        throw `Not implemented [reorderNode.ts -> moveUp()]`
    }

    // Add the node to each object in config file info
    let selfConfig: ConfigFileInfoExpanded | null = null;
    const newConfig: ConfigFileInfoExpanded[] = [];
    Object.entries(dotConfig).forEach(([ fileName, config ]) => {
        // Do not sort the 'self' node in config info -- as that is the reference to the parent container itself
        if (fileName === 'self') {
            selfConfig = {
                fileName: fileName,
                node: parentNode,
                ordering: 1000000,
                title: config.title
            };
            return;
        }

        // Find the current node in its parent's container
        const node = container.find(un => un.data.ids.fileName === fileName);
        if (!node) return;

        // Create expanded config file info for it (add a node: OutlineNode field)
        newConfig.push({
            fileName: fileName,
            node: node,
            ordering: config.ordering,
            title: config.title
        });
    });
    
    // Re order the nodes
    const reorderedNodes = await reorderUp(newConfig, targets);

    // Update the internal outline tree structure by first clearing the moving node's parent container
    // Then, re-insert each node in the loop below
    while (container.length) container.pop();

    if (selfConfig) {
        container.push(selfConfig);
        reorderedNodes.unshift(selfConfig);
    }

    // Re format the array of ConfigFileInfoExpandeds into a single object { string -> ConfigFileInfo }
    const reformated: { [index: string]: ConfigFileInfo } = {};
    reorderedNodes.forEach(({ fileName, ordering, title, node }) => {
        reformated[fileName] = { ordering, title };

        // Since reOrderedNodes is sorted, we can insert those nodes back into
        //      the parent container in order that they are presented to us in this array
        container.push(node);
    });

    // Write the re formated .config file
    await writeDotConfig(dotConfigUri, reformated);
    await this.refresh(parentNode);
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
        return target.data.ids.parentUri.toString() === resource.data.ids.parentUri.toString();
    });

    if (!targets.find(target => target.data.ids.uri.toString() === resource.data.ids.uri.toString())) {
        targets.push(resource);
    }

    // Get the path of the .config file for the moving nodes
    const dotConfigUri = await resource.getDotConfigPath(this);
    if (!dotConfigUri) return;

    // Read .config from disk
    const dotConfig = await readDotConfig(dotConfigUri);
    if (!dotConfig) return;
    

    const parentNode = (await this._getTreeElementByUri(resource.data.ids.parentUri)) as OutlineNode;

    // Find the unordered list from the parent node based on the mover type
    let container: OutlineNode[];
    if (resource.data.ids.type === 'chapter') {
        container = (parentNode.data as ContainerNode).contents;
    }
    else if (resource.data.ids.type === 'fragment') {
        container = (parentNode.data as SnipNode | ChapterNode).textData;
    }
    else if (resource.data.ids.type === 'snip') {
        container = (parentNode.data as ContainerNode).contents;
    }
    else {
        throw `Not implemented [reorderNode.ts -> moveUp()]`
    }

    // Add the node to each object in config file info
    let selfConfig: ConfigFileInfoExpanded | null = null;
    const newConfig: ConfigFileInfoExpanded[] = [];
    Object.entries(dotConfig).forEach(([ fileName, config ]) => {
        // Do not sort the 'self' node in config info -- as that is the reference to the parent container itself
        if (fileName === 'self') {
            selfConfig = {
                fileName: fileName,
                node: parentNode,
                ordering: 1000000,
                title: config.title
            };
            return;
        }

        // Find the current node in its parent's container
        const node = container.find(un => un.data.ids.fileName === fileName);
        if (!node) return;

        // Create expanded config file info for it (add a node: OutlineNode field)
        newConfig.push({
            fileName: fileName,
            node: node,
            ordering: config.ordering,
            title: config.title
        });
    });

    // Re order the nodes
    const reorderedNodes = await reorderDown(newConfig, targets);

    // Update the internal outline tree structure by first clearing the moving node's parent container
    // Then, re-insert each node in the loop below
    while (container.length) container.pop();

    if (selfConfig) {
        container.push(selfConfig);
        reorderedNodes.unshift(selfConfig);
    }

    // Re format the array of ConfigFileInfoExpandeds into a single object { string -> ConfigFileInfo }
    const reformated: { [index: string]: ConfigFileInfo } = {};
    reorderedNodes.forEach(({ fileName, ordering, title, node }) => {
        reformated[fileName] = { ordering, title };

        // Since reOrderedNodes is sorted, we can insert those nodes back into
        //      the parent container in order that they are presented to us in this array
        container.push(node);
    });
    
    // Write the re formated .config file
    await writeDotConfig(dotConfigUri, reformated);
    await this.refresh(parentNode);
    this.view.reveal((this.tree.data as RootNode).chapters, { focus: true, select: true });
}