import * as vscode from 'vscode';

// Handles the case when a node is moved (dragged and dropped) into a container which is 
//      not the same as its original parent
// In this case we need to shift internal contents of the outline tree as well as the

import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from "../outlineNode";
import { OutlineTreeProvider, TreeNode } from '../../../outlineProvider/outlineTreeProvider';
import { MoveNodeResult } from './common';
import { getLatestOrdering, readDotConfig, writeDotConfig } from '../../../help';
import { RecyclingBinView } from '../../../recyclingBin/recyclingBinView';
import { getUsableFileName } from '../../impl/createNodes';
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { updateTextFragmentContainer } from '../updateChildrenToReflectNewUri';

//      config files for both the destination and the original parent containers
export async function handleContainerSwap (
    operation: 'move' | 'recover',
    node: OutlineNode,
    destinationProvider: OutlineTreeProvider<TreeNode>,
    sourceProvider: UriBasedView<OutlineNode>,
    destinationContainer: OutlineNode, 
): Promise<MoveNodeResult> {
    // Old path of the node we will be moving
    const moverOriginalUri = node.getUri();
    const moverOriginalOpenState = destinationProvider.getOpenedStatusOfNode(moverOriginalUri);

    // Path for the new fragment, and its new .config file
    const destinationContainerUri = destinationContainer.getUri();
    const destinationDotConfigUri = vscode.Uri.joinPath(destinationContainerUri, '.config');
    
    // Uri where the mover will be moved to
    const newFileName = operation === 'move'
        ? node.data.ids.fileName
        : getUsableFileName(node.data.ids.type, node.data.ids.type === 'fragment');
    const moverDestinationUri = vscode.Uri.joinPath(destinationContainerUri, newFileName);
    
    // Set the opened status of the destination to the original open status
    if (moverOriginalOpenState !== undefined) {
        destinationProvider.setOpenedStatusNoUpdate(moverDestinationUri, moverOriginalOpenState);
    }
    
    // Edit the .config for the new parent container to contain the record of the moved node
    let movedFragmentNumber = 1000000;
    const destinationDotConfig = await readDotConfig(destinationDotConfigUri);
    {
        if (!destinationDotConfig) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
    
        // Find the record in the new .config file with the highest ordering
        const latestFragmentNumber = getLatestOrdering(destinationDotConfig);
        movedFragmentNumber = latestFragmentNumber + 1;
    
        // Add the record for the moved fragment to the new .config file and write to disk
        destinationDotConfig[newFileName] = {
            title: node.data.ids.display,
            ordering: movedFragmentNumber
        };
        await writeDotConfig(destinationDotConfigUri, destinationDotConfig);
    }

    // Update recycling log if this is a root node in the recycling tree
    let spliceFromContainer: boolean = false;
    if (operation === 'recover' && node.data.ids.relativePath === '') {
        const log = await RecyclingBinView.readRecycleLog();
        if (!log) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };

        const rootIndex = sourceProvider.rootNodes.findIndex(li => li.data.ids.fileName === node.data.ids.fileName);
        if (rootIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        sourceProvider.rootNodes.splice(rootIndex, 1);

        const removeLogIndex = log.findIndex(li => li.recycleBinName === node.data.ids.fileName);
        if (removeLogIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        log.splice(removeLogIndex, 1);
        await RecyclingBinView.writeRecycleLog(log);    
    }
    // Update the internal container and .config file for the removed node, if the moved node is not a root
    //      item in the recycling bin
    else {
        const movedRecordTitle = await node.shiftTrailingNodesDown(sourceProvider);
        if (movedRecordTitle === '') {
            return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        }

        spliceFromContainer = true;
    }
    // Update internal 

    // Rename (move) the node on disk
    await vscode.workspace.fs.rename(moverOriginalUri, moverDestinationUri);

    // Store old parental information before update
    const oldParentUri = node.data.ids.parentUri;
    const oldParentNode: OutlineNode | null = await sourceProvider.getTreeElementByUri(oldParentUri);
    let oldParentContents: OutlineNode[] | undefined;

    // Alter the internal data of the moving node to reflect its new ordering and parent
    node.data.ids.fileName = newFileName;
    node.data.ids.parentUri = destinationContainer.data.ids.uri;
    node.data.ids.parentTypeId = destinationContainer.data.ids.type;
    node.data.ids.uri = moverDestinationUri;
    node.data.ids.relativePath = `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}`;
    node.data.ids.ordering = movedFragmentNumber;

    // Move the node inside of the actual outline tree
    // Operation is performed differently for moving a snip and moving a 
    //      fragment, as their container arrays are named and reached differently
    if (node.data.ids.type === 'snip') {
        // Snips reside in `ContainerNode`s, in a `contents` array
        (destinationContainer.data as ContainerNode).contents.push(node);

        if (operation === 'move' || spliceFromContainer) {
            oldParentContents = (oldParentNode?.data as ContainerNode).contents;
        }

        // Must also edit the internals of each fragment inside of this snip
        //      in order to reflect this move
        const fragmentRelativePath = `${node.data.ids.relativePath}/${node.data.ids.fileName}`;
        updateTextFragmentContainer({
            node: node.data as SnipNode,
            parentUri: moverDestinationUri,
            relativePath: fragmentRelativePath,
        });
    }
    else if (node.data.ids.type === 'fragment') {
        // Fragments reside in `ChapterNode`s or `SnipNode`s, in a `textData` array
        (destinationContainer.data as ChapterNode | SnipNode).textData.push(node);
        if (operation === 'move' || spliceFromContainer) {
            oldParentContents = (oldParentNode?.data as SnipNode | ChapterNode).textData;
        }
    }
    else if (node.data.ids.type === 'chapter') {
        (((destinationProvider.rootNodes[0] as OutlineNode).data as RootNode).chapters.data as ContainerNode).contents.push(node);
        if (operation === 'move' || spliceFromContainer) {
            oldParentContents = (((destinationProvider.rootNodes[0] as OutlineNode).data as RootNode).chapters.data as ContainerNode).contents;
        }

        if (operation === 'recover') {
            // When recovering, we need to push the updates to the chapter's new location down to all the children nodes of 
            //      the recovered chapter
            // Only need to do this when recovering because that is the only time when a chapter's internal
            //      location data (relative path/uri/parent uri) updates
            //      when operation === 'move' the destination container for a chapter is always, always 
            //      going to be the same container that it originated in because chapters can only
            //      exist in the recycling bin or in the root chapters container node
            node.updateChildrenToReflectNewUri();
        }
    }
    else throw new Error(`Not possible`);

    if (operation === 'move' || spliceFromContainer) {
        if (!oldParentContents) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        // Get the index of the mover in the parent's contents
        const moverUri = node.getUri().toString();
        const oldParentIndex = oldParentContents.findIndex(node => node.getUri().toString() === moverUri);
        if (oldParentIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
    
        // Remove this from parent
        oldParentContents.splice(oldParentIndex, 1);
    }

    const containers = [ destinationContainer ];
    if (oldParentNode) {
        containers.push(oldParentNode);
    }

    return { moveOffset: 0, createdDestination: null, effectedContainers: containers };
}