import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from "../../help";
import { MoveNodeResult, OutlineTreeProvider, TreeNode } from "../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../node";
import { OutlineView } from '../outlineView';
import * as extension from './../../extension';
import { Workspace } from '../../workspace/workspaceClass';

// Map of a resource type to all resource types that the key can be moved into
const allowedMoves: { [index: string]: ResourceType[] } = {
    'snip': [
        'chapter',
        'fragment',
        'root',
        'container',
        'snip'
    ],
    'chapter': [
        'chapter'
    ],
    'root': [],
    'container': [
        'chapter',
        'root',
        'snip',
        'container',
        'fragment'
    ],
    'fragment': [
        'chapter',
        'snip',
        'fragment',
        'container'
    ],
};

export async function moveNode (
    this: OutlineNode,
    newParent: TreeNode, 
    provider: OutlineTreeProvider<TreeNode>,
    moveOffset: number,
    overrideDestination: TreeNode | null
): Promise<MoveNodeResult> {
    const newParentNode = newParent as OutlineNode;
    const newParentType = newParentNode.data.ids.type;
    const newParentUri = newParentNode.data.ids.uri;
    
    const moverType = this.data.ids.type;
    const moverParentUri = this.data.ids.parentUri;
    
    const thisAllowedMoves = allowedMoves[moverType];
    if (!thisAllowedMoves.find(allowed => allowed === newParentType)) {
        return { moveOffset: -1, effectedContainers: [], createdDestination: null };
    }

    if (moverType === 'container') {
        // If the moving item is a container, it must be a snip container
        // Check to make sure that the type of the first child of the container is a snip
        const moverNode = this.data as ContainerNode;
        const moverContent: OutlineNode[] = moverNode.contents;
        if (moverContent.length === 0 || moverContent[0].data.ids.type === 'chapter') {
            throw new Error('Not possible');
        }
        
        // Find the target where the snip should move into
        let containerTarget: TreeNode;
        containerTarget = newParent;
        
        // Create shallow copy of all snips because removing nodes from the 
        //      original `contents` array (which is what `moveNode` does)
        //      will cause skipping of some nodes otherwise
        const snips = [ ...moverContent ];
        
        const effectedContainersUriMap: {
			[index: string]: TreeNode,
		} = {};

        // Move each snip one by one
        let acc = 0;
        for (const snip of snips) {
            let { moveOffset, createdDestination, effectedContainers } = await snip.moveNode(containerTarget, provider, 0, null);
            if (moveOffset === -1) return { moveOffset: -1, effectedContainers: [], createdDestination: null };
            acc += moveOffset;

            for (const container of effectedContainers) {
                effectedContainersUriMap[container.getUri().fsPath] = container;
            }
        }

        
        const allEffectedContainers = Object.entries(effectedContainersUriMap)
            .map(([ _, container ]) => container);
        return { moveOffset: acc, createdDestination: null, effectedContainers: allEffectedContainers };
    }

    // If the mover is not a container, then we're only moving a single item:

    let newOverride: OutlineNode | undefined;

    let destinationContainer: OutlineNode;
    if (moverType === 'snip') {
        // Use the root's .snips container
        if (newParentType === 'root') {
            const root: RootNode = (provider.tree as OutlineNode).data as RootNode;
            destinationContainer = (root.snips as OutlineNode);
        }
        // Use the chapter's .snips container
        else if (newParentType === 'chapter') {
            const chapterNode: ChapterNode = (await provider._getTreeElementByUri(newParentUri)).data;
            destinationContainer = chapterNode.snips;
        }
        // Traverse upwards until we find the nearest 'root' or 'chapter' node that we can move the snip into
        else if (newParentType === 'snip' || newParentType === 'container' || newParentType === 'fragment') {
            const parentContainerNode = (await newParentNode.getContainerParent(provider)).data as ChapterNode | RootNode;
            destinationContainer = parentContainerNode.snips;
        }
        else {
            throw new Error('Not possible');
        }
    }
    else if (moverType === 'fragment') {
        if (newParentType === 'chapter' || newParentType === 'snip') {
            destinationContainer = (await provider._getTreeElementByUri(newParentUri));
        }
        else if (newParentType === 'fragment') {
            destinationContainer = (await newParentNode.getContainerParent(provider, 'snip'));
        }
        else if (newParentType === 'container') {
            const newParentOutline = newParent as OutlineNode;
            const outlineView = provider as OutlineView;

            if (overrideDestination) {
                // If a previous call to this function resulted in a an override destination
                //      container, then use that container as the overrided destination
                destinationContainer = overrideDestination as OutlineNode;
            }
            else if (
                newParentOutline.data.ids.parentTypeId === 'chapter' 
                || outlineView.workspace.workSnipsFolder.fsPath === newParentOutline.data.ids.uri.fsPath
            ) {
                // If this is a chapter snip container or the work snip container, then
                //      create a new snip for the fragments to move to
                const snipUri = await outlineView.newSnip(newParentOutline, {
                    defaultName: `Created Snip`,
                    skipFragment: true,
                    preventRefresh: true,
                });
                if (!snipUri) return { moveOffset: -1, effectedContainers: [], createdDestination: null };

                // Get the snip node itself from the outline view 
                const snipNode = await outlineView._getTreeElementByUri(snipUri);

                // Use that snip node as both the override for all potential future
                //      fragment moves and as the destination node
                newOverride = snipNode;
                destinationContainer = snipNode;
            }
            else return { moveOffset: -1, effectedContainers: [], createdDestination: null };
        }
        else {
            throw new Error('Not possible.');
        }
    }  
    else if (moverType === 'chapter') {
        destinationContainer = ((provider.tree as OutlineNode).data as RootNode).chapters;
    }
    else {
        return { moveOffset: -1, effectedContainers: [], createdDestination: null };
    }

    // If the container of the destination is the same as the container of the mover, then we're 
    //      not actually moving the node anywhere, we are just changing the internal ordering
    // This is an entirely separate set of logic than moving to a different container
    if (destinationContainer.getUri().toString() === moverParentUri.toString()) {
        return await handleInternalContainerReorder(this, destinationContainer, newParentNode, moveOffset);
    }
    else {
        try {
            const swapResult = await handleContainerSwap(this, provider, destinationContainer);
            return { 
                moveOffset: swapResult.moveOffset, 
                createdDestination: newOverride || null,
                effectedContainers: swapResult.effectedContainers 
            };
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error: unable to move fragment file: ${e}`);
            return { moveOffset: 0, createdDestination: null, effectedContainers: [] };
        }
    }
}

// Handles the case when a node is moved (dragged and dropped) within its own container
// In this case, we need to shift around the ordering of the node's parent's config file
async function handleInternalContainerReorder (node: OutlineNode, destinationContainer: OutlineNode, newParentNode: OutlineNode, moveOffset: number): Promise<MoveNodeResult> {
    // Get the .config for the container -- this contains the ordering values for both the mover
    //      and the destination item
    // (Destination item is just the item that the mover was dropped onto -- not actually destination,
    //      as there is no moving actually occurring)
    const containerDotConfigUri = vscodeUris.Utils.joinPath(destinationContainer.getUri(), `.config`);
    const containerConfig = await readDotConfig(containerDotConfigUri);
    if (!containerConfig) return { moveOffset: -1, effectedContainers: [], createdDestination: null };

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
        unordered = (destinationContainer.data as SnipNode | ChapterNode).textData;
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

    return { moveOffset: off, createdDestination: null, effectedContainers: [ destinationContainer ] };
}


// Handles the case when a node is moved (dragged and dropped) into a container which is 
//      not the same as its original parent
// In this case we need to shift internal contents of the outline tree as well as the
//      config files for both the destination and the original parent containers
async function handleContainerSwap (
    node: OutlineNode,
    provider: OutlineTreeProvider<TreeNode>,
    destinationContainer: OutlineNode, 
): Promise<MoveNodeResult> {
    // Old path of the node we will be moving
    const moverOriginalUri = node.getUri();
    const moverOriginalOpenState = provider.getOpenedStatusOfNode(moverOriginalUri);

    // Path for the new fragment, and its new .config file
    const destinationContainerUri = destinationContainer.getUri();
    const destinationDotConfigUri = vscodeUris.Utils.joinPath(destinationContainerUri, '.config');
    
    // Uri where the mover will be moved to
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
    {
        const destinationDotConfig = await readDotConfig(destinationDotConfigUri);
        if (!destinationDotConfig) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
    
        // Find the record in the new .config file with the highest ordering
        const latestFragmentNumber = getLatestOrdering(destinationDotConfig);
        movedFragmentNumber = latestFragmentNumber + 1;
    
        const movedRecordTitle = await node.shiftTrailingNodesDown(provider as OutlineTreeProvider<OutlineNode>);
        if (movedRecordTitle === '') {
            return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        }
    
        // Add the record for the moved fragment to the new .config file and write to disk
        destinationDotConfig[node.data.ids.fileName] = {
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
    const oldParentNode: OutlineNode = await provider._getTreeElementByUri(oldParentUri);
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
            fragment.data.ids.uri = vscodeUris.Utils.joinPath(moverDestinationUri, fragmentName);
            fragment.data.ids.parentUri = moverOriginalUri;
            fragment.data.ids.relativePath = `${node.data.ids.relativePath}/${node.data.ids.fileName}`;
        });
    }
    else if (node.data.ids.type === 'fragment') {
        // Fragments reside in `ChapterNode`s or `SnipNode`s, in a `textData` array
        (destinationContainer.data as ChapterNode | SnipNode).textData.push(node);
        oldParentContents = (oldParentNode.data as SnipNode | ChapterNode).textData;
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