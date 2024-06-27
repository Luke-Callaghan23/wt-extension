import * as vscode from 'vscode';
// Handles the case when a node is moved (dragged and dropped) within its own container

import { ConfigFileInfo, readDotConfig, writeDotConfig } from "../../../help";
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from "../outlineNode";
import { MoveNodeResult } from './common';

// In this case, we need to shift around the ordering of the node's parent's config file
export async function handleInternalContainerReorder (
    node: OutlineNode, 
    destinationContainer: OutlineNode, 
    newParentNode: OutlineNode, 
    moveOffset: number,
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
): Promise<MoveNodeResult> {
    // Get the .config for the container -- this contains the ordering values for both the mover
    //      and the destination item
    // (Destination item is just the item that the mover was dropped onto -- not actually destination,
    //      as there is no moving actually occurring)
    const containerDotConfigUri = vscode.Uri.joinPath(destinationContainer.getUri(), `.config`);
    const containerConfig = await readDotConfig(containerDotConfigUri);
    if (!containerConfig) return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };

    type FileInfo = {
        filename: string,
        config: ConfigFileInfo
    };

    // Buckets for items pre-reorder
    // Container for items that come between the mover and the detination
    const between: FileInfo[] = [];         

    // Minimum and maximum are just aliases for the mover and the destination where "min" is the 
    //      items that has a lower ordering and "max" is the item that has higher ordering
    const moverOrdering = containerConfig[node.data.ids.fileName].ordering;
    const destOrdering = containerConfig[newParentNode.data.ids.fileName].ordering;
    const [ min, max ] = moverOrdering < destOrdering
        ? [ moverOrdering, destOrdering ]
        : [ destOrdering, moverOrdering ];

    let minEntry: FileInfo | null = null;
    let maxEntry: FileInfo | null = null;

    // Place all items in the .config into their respective buckets
    Object.entries(containerConfig).forEach(([ filename, info ]) => {
        if (info.ordering === min) minEntry = { filename, config: info };                   // ordering is min -> min
        if (info.ordering === max + moveOffset) maxEntry = { filename, config: info };      // ordering is max -> max
        else if (info.ordering > min && info.ordering < max + moveOffset) {
            between.push({ filename, config: info });
        }
    });
    if (!minEntry || !maxEntry) {
        throw new Error ('Not possible');
    }

    let off = 0;
    if (moverOrdering < destOrdering) {
        // If the mover comes before the destination, then move it after
        const mover = minEntry as FileInfo;
        const dest = maxEntry as FileInfo;

        // All items in between get shifted down
        between.forEach(({ filename }) => {
            containerConfig[filename].ordering -= 1;
        });

        // Destination gets shifted down
        const oldDestOrdering = containerConfig[dest.filename].ordering;
        containerConfig[dest.filename].ordering = oldDestOrdering - 1;

        // Mover gets old destination's ordering
        containerConfig[mover.filename].ordering = oldDestOrdering;

        // Tell the caller that a node has moved downwards
        // So that if there are multiple nodes moving downwards in the same container,
        //      the next time moveNode is called we know
        off = 1;
    }
    else {
        // If the mover comes after the destination, then move it before
        const mover = maxEntry as FileInfo;
        const dest = minEntry as FileInfo;

        // All items in between get shifted up
        between.forEach(({ filename }) => {
            containerConfig[filename].ordering += 1;
        });

        // Destination gets shifted up
        const oldDestOrdering = containerConfig[dest.filename].ordering;
        containerConfig[dest.filename].ordering = oldDestOrdering + 1;

        // Mover gets old destination's ordering
        containerConfig[mover.filename].ordering = oldDestOrdering;
    }

    // Write the edited config back to the disk
    await writeDotConfig(containerDotConfigUri, containerConfig);

    // Find the unordered list from the parent node based on the mover type
    let unordered: OutlineNode[];
    if (node.data.ids.type === 'chapter') {
        unordered = (destinationContainer.data as ContainerNode).contents;
    }
    else if (node.data.ids.type === 'fragment') {
        if (destinationContainer.data.ids.type === 'snip') {
            unordered = (destinationContainer.data as SnipNode).contents;
        }
        else if (destinationContainer.data.ids.type === 'chapter') {
            unordered = (destinationContainer.data as ChapterNode).textData;
        }
        else throw `unsupported parent type ${destinationContainer.data.ids.type}`;
    }
    else if (node.data.ids.type === 'snip') {
        unordered = (destinationContainer.data as ContainerNode).contents;
    }

    // Now change the ordering of the items inside the `unordered` array found above
    //      in order to match the ordering of the items in `containerConfig`
    Object.entries(containerConfig).forEach(([ fileName, config ]) => {
        // Find the node itself in the `unordered` list
        const moving = unordered.find(un => un.data.ids.fileName === fileName);
        if (!moving) return;

        // Set the ordering of this node within the internal OutlineView tree
        //      to reflect its newly calculated ordering
        moving.data.ids.ordering = config.ordering;
    });

    return { moveOffset: off, createdDestination: null, effectedContainers: [ destinationContainer ], rememberedMoveDecision: rememberedMoveDecision };
}

