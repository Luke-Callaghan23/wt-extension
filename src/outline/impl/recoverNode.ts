import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { getLatestOrdering, readDotConfig, writeDotConfig } from "../../help";
import { MoveNodeResult, OutlineTreeProvider, TreeNode } from "../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../node";
import { OutlineView } from '../outlineView';
import { RecyclingBinView } from '../../recyclingBin/recyclingBinView';
import { getUsableFileName } from './createNodes';
import { allowedMoves } from '../nodes_impl/moveNode';


export async function recoverNode (
    this: OutlineNode,
    newParent: TreeNode, 
    recycleView: RecyclingBinView,
    outlineViewProvider: OutlineTreeProvider<TreeNode>,
    overrideDestination: TreeNode | null
): Promise<MoveNodeResult> {

    const outlineView = outlineViewProvider as OutlineView;

    const newParentNode = newParent as OutlineNode;
    const newParentType = newParentNode.data.ids.type;
    const newParentUri = newParentNode.data.ids.uri;
    const moverType = this.data.ids.type;
    
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
            let { moveOffset, createdDestination, effectedContainers } = await snip.recoverNode(
                containerTarget, 
                recycleView,
                outlineView, 
                null
            );
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
            const root: RootNode = (outlineView.rootNodes[0] as OutlineNode).data as RootNode;
            destinationContainer = (root.snips as OutlineNode);
        }
        // Use the chapter's .snips container
        else if (newParentType === 'chapter') {
            const chapterNode: ChapterNode = (await outlineView.getTreeElementByUri(newParentUri)).data;
            destinationContainer = chapterNode.snips;
        }
        // Traverse upwards until we find the nearest 'root' or 'chapter' node that we can move the snip into
        else if (newParentType === 'snip' || newParentType === 'container' || newParentType === 'fragment') {
            const parentContainerNode = (await newParentNode.getContainerParent(outlineView)).data as ChapterNode | RootNode;
            destinationContainer = parentContainerNode.snips;
        }
        else {
            throw new Error('Not possible');
        }
    }
    else if (moverType === 'fragment') {
        if (newParentType === 'chapter' || newParentType === 'snip') {
            destinationContainer = (await outlineView.getTreeElementByUri(newParentUri));
        }
        else if (newParentType === 'fragment') {
            destinationContainer = (await newParentNode.getContainerParent(outlineView, 'snip'));
        }
        else if (newParentType === 'container') {
            const newParentOutline = newParent as OutlineNode;

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
                const snipNode = await outlineView.getTreeElementByUri(snipUri);

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
        destinationContainer = ((outlineView.rootNodes[0] as OutlineNode).data as RootNode).chapters;
    }
    else {
        return { moveOffset: -1, effectedContainers: [], createdDestination: null };
    }

    // If the container of the destination is the same as the container of the mover, then we're 
    //      not actually moving the node anywhere, we are just changing the internal ordering
    // This is an entirely separate set of logic than moving to a different container

    // Old path of the node we will be moving
    const moverOriginalUri = this.getUri();
    const moverOriginalOpenState = outlineView.getOpenedStatusOfNode(moverOriginalUri);

    // Path for the new fragment, and its new .config file
    const destinationContainerUri = destinationContainer.getUri();
    const destinationDotConfigUri = vscodeUris.Utils.joinPath(destinationContainerUri, '.config');
    
    // Uri where the mover will be moved to
    const newFileName = getUsableFileName(this.data.ids.type, true);
    const moverDestinationUri = vscode.Uri.joinPath(destinationContainerUri, newFileName);
    
    // Set the opened status of the destination to the original open status
    if (moverOriginalOpenState !== undefined) {
        outlineView.setOpenedStatusNoUpdate(moverDestinationUri, moverOriginalOpenState);
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
    
        // Add the record for the moved fragment to the new .config file and write to disk
        destinationDotConfig[newFileName] = {
            title: this.data.ids.display,
            ordering: movedFragmentNumber
        };
        const updateDestinationContainerPromise = writeDotConfig(destinationDotConfigUri, destinationDotConfig);
        awaitables.push(updateDestinationContainerPromise);
    }

    // Update recycling log if this is a root node in the recycling tree
    let spliceFromContainer: boolean = false;
    if (this.data.ids.relativePath === '') {
        const log = await RecyclingBinView.readRecycleLog();
        if (!log) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };

        const rootIndex = recycleView.rootNodes.findIndex(li => li.data.ids.fileName === this.data.ids.fileName);
        if (rootIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        recycleView.rootNodes.splice(rootIndex, 1);

        const removeLogIndex = log.findIndex(li => li.recycleBinName === this.data.ids.fileName);
        if (removeLogIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        log.splice(removeLogIndex, 1);
        awaitables.push(RecyclingBinView.writeRecycleLog(log));    
    }
    else {

        // Find the record in the new .config file with the highest ordering
        const latestFragmentNumber = getLatestOrdering(destinationDotConfig);
        movedFragmentNumber = latestFragmentNumber + 1;
    
        const movedRecordTitle = await this.shiftTrailingNodesDown(recycleView);
        if (movedRecordTitle === '') {
            return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
        }

        spliceFromContainer = true;
    }
    // Update internal 

    // Rename (move) the node on disk -- doesn't need to be awaited right away
    const renameMoverNodePromise = vscode.workspace.fs.rename(moverOriginalUri, moverDestinationUri);
    awaitables.push(renameMoverNodePromise);

    // Store old parental information before update
    const oldParentUri = this.data.ids.parentUri;
    const oldParentNode: OutlineNode = await recycleView.getTreeElementByUri(oldParentUri);
    let oldParentContents: OutlineNode[];

    // Alter the internal data of the moving node to reflect its new ordering and parent
    this.data.ids.parentUri = destinationContainer.data.ids.uri;
    this.data.ids.parentTypeId = destinationContainer.data.ids.type;
    this.data.ids.uri = moverDestinationUri;

    // Move the node inside of the actual outline tree
    // Operation is performed differently for moving a snip and moving a 
    //      fragment, as their container arrays are named and reached differently
    if (this.data.ids.type === 'snip') {
        // Snips reside in `ContainerNode`s, in a `contents` array
        (destinationContainer.data as ContainerNode).contents.push(this);
        oldParentContents = (oldParentNode.data as ContainerNode).contents;

        // Must also edit the internals of each fragment inside of this snip
        //      in order to reflect this move
        (this.data as SnipNode).textData.forEach(fragment => {
            const fragmentName = fragment.data.ids.fileName;
            fragment.data.ids.uri = vscodeUris.Utils.joinPath(moverDestinationUri, fragmentName);
            fragment.data.ids.parentUri = moverOriginalUri;
            fragment.data.ids.relativePath = `${this.data.ids.relativePath}/${this.data.ids.fileName}`;
        });
    }
    else if (this.data.ids.type === 'fragment') {
        // Fragments reside in `ChapterNode`s or `SnipNode`s, in a `textData` array
        (destinationContainer.data as ChapterNode | SnipNode).textData.push(this);
        oldParentContents = (oldParentNode.data as SnipNode | ChapterNode).textData;
    }
    else if (this.data.ids.type === 'chapter') {
        (((outlineView.rootNodes[0] as OutlineNode).data as RootNode).chapters.data as ContainerNode).contents.push(this);
        oldParentContents = (((outlineView.rootNodes[0] as OutlineNode).data as RootNode).chapters.data as ContainerNode).contents;
    }
    else throw new Error("Not possible");

    if (spliceFromContainer) {
        // Get the index of the mover in the parent's contents
        const moverUri = this.getUri().toString();
        const oldParentIndex = oldParentContents.findIndex(node => node.getUri().toString() === moverUri);
        if (oldParentIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [] };
    
        // Remove this from parent
        oldParentContents.splice(oldParentIndex, 1);
    }

    await Promise.all(awaitables);
    return { moveOffset: 0, createdDestination: null, effectedContainers: [ destinationContainer, oldParentNode ] };
}