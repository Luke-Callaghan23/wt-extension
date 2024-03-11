import * as vscode from 'vscode';

// Handles the case when a node is moved (dragged and dropped) into a container which is 
//      not the same as its original parent
// In this case we need to shift internal contents of the outline tree as well as the

import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from "../../node";
import { OutlineTreeProvider, TreeNode } from '../../../outlineProvider/outlineTreeProvider';
import { MoveNodeResult } from './common';
import { getLatestOrdering, readDotConfig, writeDotConfig } from '../../../help';

//      config files for both the destination and the original parent containers
export async function handleContainerSwap_old (
    operation: 'move' | 'recover',
    node: OutlineNode,
    provider: OutlineTreeProvider<TreeNode>,
    destinationContainer: OutlineNode, 
): Promise<MoveNodeResult> {
    // Old path of the node we will be moving
    const moverOriginalUri = node.getUri();
    const moverOriginalOpenState = provider.getOpenedStatusOfNode(moverOriginalUri);

    // Path for the new fragment, and its new .config file
    const destinationContainerUri = destinationContainer.getUri();
    const destinationDotConfigUri = vscode.Uri.joinPath(destinationContainerUri, '.config');
    
    // Uri where the mover will be moved to
    const newFileName = node.data.ids.fileName;
    const moverDestinationUri = vscode.Uri.joinPath(destinationContainerUri, node.data.ids.fileName);
    
    // Set the opened status of the destination to the original open status
    if (moverOriginalOpenState !== undefined) {
        provider.setOpenedStatusNoUpdate(moverDestinationUri, moverOriginalOpenState);
    }
    
    // Array of promises that do not need to be awaited right away and can be done concurrently in the 
    //      background while other processes execute
    const awaitables: (Promise<any> | Thenable<any>)[] = [];

    // Edit the .config for the new parent container to contain the record of the moved node
    let movedFragmentNumber = 1000000;
    const destinationDotConfig = await readDotConfig(destinationDotConfigUri);
    {
        if (!destinationDotConfig) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
    
        // Find the record in the new .config file with the highest ordering
        const latestFragmentNumber = getLatestOrdering(destinationDotConfig);
        movedFragmentNumber = latestFragmentNumber + 1;
    
        const movedRecordTitle = await node.shiftTrailingNodesDown(provider as OutlineTreeProvider<OutlineNode>);
        if (movedRecordTitle === '') {
            return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        }
    
        // Add the record for the moved fragment to the new .config file and write to disk
        destinationDotConfig[newFileName] = {
            title: movedRecordTitle,
            ordering: movedFragmentNumber
        };
        const updateDestinationContainerPromise = writeDotConfig(destinationDotConfigUri, destinationDotConfig);
        awaitables.push(updateDestinationContainerPromise);
    }

    // Rename (move) the node on disk -- doesn't need to be awaited right away
    const renameMoverNodePromise = vscode.workspace.fs.rename(moverOriginalUri, moverDestinationUri);
    awaitables.push(renameMoverNodePromise);

    // Store old parental information before update
    const oldParentUri = node.data.ids.parentUri;
    const oldParentNode: OutlineNode = await provider.getTreeElementByUri(oldParentUri);
    let oldParentContents: OutlineNode[];

    // Alter the internal data of the moving node to reflect its new ordering and parent
    node.data.ids.parentUri = destinationContainer.data.ids.uri;
    node.data.ids.parentTypeId = destinationContainer.data.ids.type;
    node.data.ids.ordering = movedFragmentNumber;
    node.data.ids.uri = moverDestinationUri;

    // Move the node inside of the actual outline tree
    // Operation is performed differently for moving a snip and moving a 
    //      fragment, as their container arrays are named and reached differently
    if (node.data.ids.type === 'snip') {
        // Snips reside in `ContainerNode`s, in a `contents` array
        (destinationContainer.data as ContainerNode).contents.push(node);
        oldParentContents = (oldParentNode.data as ContainerNode).contents;

        // Must also edit the internals of each fragment inside of this snip
        //      in order to reflect this move
        (node.data as SnipNode).textData.forEach(fragment => {
            const fragmentName = fragment.data.ids.fileName;
            fragment.data.ids.uri = vscode.Uri.joinPath(moverDestinationUri, fragmentName);
            fragment.data.ids.parentUri = moverOriginalUri;
            fragment.data.ids.relativePath = `${node.data.ids.relativePath}/${node.data.ids.fileName}`;
        });
    }
    else if (node.data.ids.type === 'fragment') {
        // Fragments reside in `ChapterNode`s or `SnipNode`s, in a `textData` array
        (destinationContainer.data as ChapterNode | SnipNode).textData.push(node);
        oldParentContents = (oldParentNode.data as SnipNode | ChapterNode).textData;
    }
    else if (node.data.ids.type === 'chapter') {
        (((provider.rootNodes[0] as OutlineNode).data as RootNode).chapters.data as ContainerNode).contents.push(node);
        oldParentContents = (((provider.rootNodes[0] as OutlineNode).data as RootNode).chapters.data as ContainerNode).contents;
    }
    else throw new Error(`Not possible`);

    // Get the index of the mover in the parent's contents
    const moverUri = node.getUri().toString();
    const oldParentIndex = oldParentContents.findIndex(node => node.getUri().toString() === moverUri);
    if (oldParentIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };

    // Remove this from parent
    oldParentContents.splice(oldParentIndex, 1);

    await Promise.all(awaitables);
    return { moveOffset: 0, createdDestination: null, effectedContainers: [ destinationContainer, oldParentNode ] };
}