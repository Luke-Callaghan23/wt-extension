import * as vscode from 'vscode';
import { ChapterNode, ContainerNode, FragmentNode, OutlineNode, RootNode, SnipNode } from "../outlineNode";
import { OutlineTreeProvider, TreeNode } from '../../../outlineProvider/outlineTreeProvider';
import { MoveNodeResult } from './common';
import { compareFsPath, ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../../../miscTools/help';
import { RecyclingBinView } from '../../../recyclingBin/recyclingBinView';
import { getUsableFileName } from '../../impl/createNodes';
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { updateChapterTextFragments, updateSnipContent } from '../updateChildrenToReflectNewUri';

// Handles the case when a node is moved (dragged and dropped) into a container which is 
//      not the same as its original parent
// In this case we need to shift internal contents of the outline tree as well as the
//      config files for both the destination and the original parent containers
export async function handleContainerSwap (
    operation: 'move' | 'recover' | 'scratch' | 'paste',
    node: OutlineNode,
    destinationProvider: OutlineTreeProvider<TreeNode>,
    sourceProvider: UriBasedView<OutlineNode>,
    destinationContainer: OutlineNode, 
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
): Promise<MoveNodeResult> {
    // Old path of the node we will be moving
    const moverOriginalUri = node.getUri();
    const moverOriginalOpenState = destinationProvider.getOpenedStatusOfNode(moverOriginalUri);

    // Path for the new fragment, and its new .config file
    const destinationContainerUri = destinationContainer.getUri();
    const destinationDotConfigUri = vscode.Uri.joinPath(destinationContainerUri, '.config');
    
    // Uri where the mover will be moved to
    const newFileName = operation === 'move' || operation === 'scratch'
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
        if (!destinationDotConfig) return { moveOffset: -1, createdDestination: null, effectedContainers: [], rememberedMoveDecision: null };
    
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
        if (!log) return { moveOffset: -1, createdDestination: null, effectedContainers: [], rememberedMoveDecision: null };

        const rootIndex = sourceProvider.rootNodes.findIndex(li => li.data.ids.fileName === node.data.ids.fileName);
        if (rootIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [], rememberedMoveDecision: null };
        sourceProvider.rootNodes.splice(rootIndex, 1);

        const removeLogIndex = log.findIndex(li => li.recycleBinName === node.data.ids.fileName);
        if (removeLogIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [], rememberedMoveDecision: null };
        log.splice(removeLogIndex, 1);
        await RecyclingBinView.writeRecycleLog(log);    
    }
    // Update the internal container and .config file for the removed node, if the moved node is not a root
    //      item in the recycling bin
    // Only do this if this is a non-paste operation -- as paste operations do not require splicing from the original container
    else if (operation !== 'paste') {
        const movedRecordTitle = await node.shiftTrailingNodesDown(sourceProvider);
        if (movedRecordTitle === '') {
            return { moveOffset: -1, createdDestination: null, effectedContainers: [], rememberedMoveDecision: null };
        }

        // No need to splice from any containers if the operation is a scratch
        if (operation !== 'scratch') {
            spliceFromContainer = true;
        }
    }
    
    // Store old parental information before update
    const oldParentUri = node.data.ids.parentUri;
    const oldParentNode: OutlineNode | null = await sourceProvider.getTreeElementByUri(oldParentUri);
    let oldParentContents: OutlineNode[] | undefined;


    // Update internal 
    if (operation !== 'paste') {
        // Rename (move) the node on disk
        await vscode.workspace.fs.rename(moverOriginalUri, moverDestinationUri);

        // Alter the internal data of the moving node to reflect its new ordering and parent
        node.data.ids.fileName = newFileName;
        node.data.ids.parentUri = destinationContainer.data.ids.uri;
        node.data.ids.parentTypeId = destinationContainer.data.ids.type;
        node.data.ids.uri = moverDestinationUri;
        node.data.ids.relativePath = `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}`;
        node.data.ids.ordering = movedFragmentNumber;
    }
    else {
        // Paste all contents of `node` into the new destination and return a new OutlineNode
        //      to represent a copy of `node`
        node = await handlePaste(node, movedFragmentNumber, destinationContainer, newFileName);
    }


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
        updateSnipContent({
            node: node.data as SnipNode,
            parentUri: moverDestinationUri,
            relativePath: fragmentRelativePath,
        });
    }
    else if (node.data.ids.type === 'fragment') {
        // Fragments reside in `ChapterNode`s or `SnipNode`s, in a `textData` array

        let contents;
        if (destinationContainer.data.ids.type === 'chapter') {
            contents = (destinationContainer.data as ChapterNode).textData;
        }
        else if (destinationContainer.data.ids.type === 'snip') {
            contents = (destinationContainer.data as SnipNode).contents;
        }
        else throw `unsupported parent type ${destinationContainer.data.ids.type}`;

        contents.push(node);
        if (operation === 'move' || spliceFromContainer) {
            
            if (oldParentNode?.data.ids.type === 'chapter') {
                oldParentContents = (oldParentNode?.data as ChapterNode).textData;
            }
            else if (oldParentNode?.data.ids.type === 'snip') {
                oldParentContents = (oldParentNode?.data as SnipNode).contents;
            }
            else throw `unsupported parent type ${oldParentNode?.data.ids.type}`;
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
        if (!oldParentContents) return { moveOffset: -1, createdDestination: null, effectedContainers: [], rememberedMoveDecision: null };
        // Get the index of the mover in the parent's contents
        const moverUri = node.getUri();
        const oldParentIndex = oldParentContents.findIndex(node => compareFsPath(node.getUri(), moverUri));
        if (oldParentIndex === -1) return { moveOffset: -1, createdDestination: null, effectedContainers: [], rememberedMoveDecision: null };
    
        // Remove this from parent
        oldParentContents.splice(oldParentIndex, 1);
    }

    const containers = [ destinationContainer ];
    if (oldParentNode) {
        containers.push(oldParentNode);
    }

    return { moveOffset: 0, createdDestination: null, effectedContainers: containers, rememberedMoveDecision: rememberedMoveDecision };
}

const handlePaste = async (
    src: OutlineNode,
    originalNewOrdering: number,
    originalDestination: OutlineNode,
    destName: string,               // Name already created for the outer-most node being copied
): Promise<OutlineNode> => {

    // Should be called under the assumption that the snip has been added to .config of destination already
    const snipPaste = async (
        snip: OutlineNode, 
        ordering: number,
        destinationContainer: OutlineNode, 
        fn: string
    ): Promise<OutlineNode> => {
        const snipDestinationPath = vscode.Uri.joinPath(destinationContainer.data.ids.uri, fn);
        await vscode.workspace.fs.createDirectory(snipDestinationPath);

        const snipContent: OutlineNode[] = [];
        const copiedSnip = new OutlineNode({
            contents: snipContent,
            ids: {
                fileName: fn,
                parentUri: destinationContainer.data.ids.uri,
                parentTypeId: destinationContainer.data.ids.type,
                uri: snipDestinationPath,
                relativePath: `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}`,
                ordering: ordering,
                display: `${snip.data.ids.display} (copy)`,
                type: 'snip'
            }
        });

        const newConfig: { [index: string]: ConfigFileInfo } = {};
        for (const content of (snip.data as SnipNode).contents) {
            const contentType = content.data.ids.type;
            const destinationFileName = getUsableFileName(contentType, contentType === 'fragment');
            const contentOrdering = content.data.ids.ordering;
            newConfig[destinationFileName] = {
                ordering: contentOrdering,
                title: `${content.data.ids.display} (copy)`,
            };

            if (contentType === 'fragment') {
                const copied = await fragmentPaste(content, contentOrdering, copiedSnip, destinationFileName);
                snipContent.push(copied);
            }
            else if (contentType === 'snip') {
                const copied = await snipPaste(content, contentOrdering, copiedSnip, destinationFileName);
                snipContent.push(copied);
            }
            else throw `Unexpected inner-snip content type: ${contentType}`;
        }

        const newConfigLocation = vscode.Uri.joinPath(snipDestinationPath, '.config');
        await writeDotConfig(newConfigLocation, newConfig);
        return copiedSnip;
    };

    // Should be called under the assumption that the fragment has been added to .config of destination already
    const fragmentPaste = async (
        fragment: OutlineNode, 
        ordering: number,
        destinationContainer: OutlineNode,
        fn: string
    ): Promise<OutlineNode> => {
        const destinationPath = vscode.Uri.joinPath(destinationContainer.data.ids.uri, fn);
        await vscode.workspace.fs.copy(fragment.data.ids.uri, destinationPath);
        return new OutlineNode({
            md: (fragment.data as FragmentNode).md,
            ids: {
                fileName: fn,
                parentUri: destinationContainer.data.ids.uri,
                parentTypeId: destinationContainer.data.ids.type,
                uri: destinationPath,
                relativePath: `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}`,
                ordering: ordering,
                display: `${fragment.data.ids.display} (copy)`,
                type: 'fragment'
            }
        })
    };

    if (src.data.ids.type === 'fragment') {
        return fragmentPaste (src, originalNewOrdering, originalDestination, destName);
    }
    else if (src.data.ids.type === 'snip') {
        return snipPaste(src, originalNewOrdering, originalDestination, destName);
    }
    else throw `Unexpected paste type: ${src.data.ids.type}`;
};