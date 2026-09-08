import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { compareFsPath, ConfigFileInfo, getLatestOrdering, isSubdirectory, readDotConfig, writeDotConfig } from "../../../miscTools/help";
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../outlineNode";
import { OutlineView } from '../../outlineView';
import { Extension } from   '../../../extension';
import { Workspace } from '../../../workspace/workspaceClass';
import { DestinationResult, MoveNodeResult, allowedMoves } from './common';
import { handleInternalContainerReorder } from './handleInternalReorder';
import { determineDestinationContainer } from './determineDestinationContainer';
import { handleContainerSwap } from './containerSwap';
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { containerMove } from './containerMove';
import { chapterMove } from './chapterMove';


export type NodeMoveKind = 'move' | 'recover' | 'scratch' | 'paste';

export async function generalMoveNode (
    this: OutlineNode,
    operation: NodeMoveKind,
    newParent: TreeNode, 
    recycleView: UriBasedView<OutlineNode>,
    outlineView: OutlineTreeProvider<TreeNode>,
    moveOffset: number,
    overrideDestination: TreeNode | null,
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
): Promise<MoveNodeResult | null> {
    const newParentNode = newParent as OutlineNode;
    const newParentType = newParentNode.data.ids.type;
    const newParentUri = newParentNode.data.ids.uri;

    if (isSubdirectory(this.data.ids.uri, newParentNode.data.ids.uri)) {
        vscode.window.showInformationMessage("[INFO] Unable to move node into itself or sub-node of itself")
        return null;
    }
    
    const moverType = this.data.ids.type;
    const moverParentUri = this.data.ids.parentUri;
    
    const thisAllowedMoves = allowedMoves[moverType];
    if (!thisAllowedMoves.find(allowed => allowed === newParentType)) {
        vscode.window.showWarningMessage(`[WARN] Cannot move '${moverType}' node '${this.data.ids.display}' into node of type '${newParentType}'.  Skipping . . . `);
        return null;
    }

    let chapterDestination: DestinationResult | undefined;
    if (moverType === 'container') {
        if (operation === 'scratch') throw 'unreachable';

        const chapterGroupsContainer = ((outlineView.rootNodes[0] as OutlineNode).data as RootNode).chapterGroups;

        // If this node is a container and so is it's parent, it is a chapter group container
        // There are special rules for moving these around
        if (this.data.ids.parentTypeId === 'container') {
            // If the destination is another chapter group, then it is just a re-order operation
            if (operation !== 'recover' && newParentType === 'container' && newParentNode.data.ids.parentTypeId === 'container') {
                return handleInternalContainerReorder(this, chapterGroupsContainer, newParentNode, moveOffset, "Reorder")
            }
            // If the the operation is recovery, 
            // and destination is root, or the chapter group container, or a chapter group
            //      then, recover the entire chapter group
            else if (
                operation === 'recover' && (
                    (newParentType === 'container' && newParentNode.data.ids.parentTypeId === 'root')
                    || (newParentType === 'container' && newParentNode.data.ids.parentTypeId === 'container')
                    || newParentType === 'root' 
                )
            ) {
                const swapResult = await handleContainerSwap('recover', this, outlineView, recycleView, chapterGroupsContainer, null);
                if (!swapResult) return null;

                return { 
                    moveOffset: swapResult.moveOffset, 
                    createdDestination: null,
                    effectedContainers: swapResult.effectedContainers,
                    rememberedMoveDecision: null,
                };
            }
            else {
                vscode.window.showErrorMessage
                throw `[ERR] Cannot move chapter group into node of type '${newParentType}'`;
            }
        }
        else {
            // Otherwise a container move involves clearing out all the cointent inside of the container and moving it into
            //      some other location
            // Specific logic for that is contained within `containerMove`
            return containerMove(operation, this, recycleView, outlineView, newParent, moveOffset);
        }

    }
    else if (moverType === 'chapter') {
        if (operation === 'scratch') throw 'unreachable';
        const chapterMoveResult = await chapterMove(
            operation, this, 
            recycleView, outlineView,
            newParentType, newParentNode, 
            moveOffset,
            rememberedMoveDecision
        );
        if (!chapterMoveResult) return null;

        if (chapterMoveResult.kind === 'move') {
            return chapterMoveResult.result;
        }
        else {
            chapterDestination = chapterMoveResult.result;
        }
    }
    

    const destinationResult = chapterDestination || await determineDestinationContainer(
        this, moverType, newParentType, 
        outlineView, newParent, 
        newParentNode, newParentUri, 
        overrideDestination,
        rememberedMoveDecision
    );
    if (destinationResult === null) return null;
    const { destinationContainer, newOverride, rememberedMoveDecision: moveDecision } = destinationResult;


    if (operation === 'recover') {
        const swapResult = await handleContainerSwap('recover', this, outlineView, recycleView, destinationContainer, moveDecision);
        if (!swapResult) return null;

        return { 
            moveOffset: swapResult.moveOffset, 
            createdDestination: newOverride || null,
            effectedContainers: swapResult.effectedContainers,
            rememberedMoveDecision: moveDecision,
        };
    }

    // If the container of the destination is the same as the container of the mover, then we're 
    //      not actually moving the node anywhere, we are just changing the internal ordering
    // This is an entirely separate set of logic than moving to a different container
    if (operation !== 'paste' && compareFsPath(destinationContainer.getUri(), moverParentUri)) {
        let finalParentNode: OutlineNode = newParentNode;
        if (moverType === 'snip' && newParentType === 'chapter') {
            const neighbors = (((newParent as OutlineNode).data as ChapterNode).snips.data as ContainerNode).contents;
            const lastNeighbor = neighbors[neighbors.length - 1];
            if (compareFsPath(lastNeighbor.data.ids.uri, this.data.ids.uri)) {
                return { moveOffset: moveOffset, createdDestination: newOverride || null, effectedContainers: [], rememberedMoveDecision: moveDecision };
            }
            finalParentNode = lastNeighbor;
        }
        return handleInternalContainerReorder(this, destinationContainer, finalParentNode, moveOffset, moveDecision);
    }

    try {
        const swapResult = await handleContainerSwap(
            operation, this, 
            outlineView, outlineView as any as UriBasedView<OutlineNode>,
            destinationContainer,
            moveDecision
        );
        if (!swapResult) return null;

        // Add the new override's parent to the effected containers if that container exists (and its parent does as well)
        const effectedContainers = swapResult.effectedContainers;
        if (newOverride) {
            const parent: OutlineNode | null = await outlineView.getTreeElementByUri(newOverride.getParentUri()) as OutlineNode | null;
            if (parent) {
                effectedContainers.push(parent);
            }
        }

        return { 
            moveOffset: swapResult.moveOffset, 
            createdDestination: newOverride || null,
            effectedContainers: effectedContainers,
            rememberedMoveDecision: moveDecision
        };
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error: unable to move fragment file: ${e}`);
        return { moveOffset: 0, createdDestination: null, effectedContainers: [], rememberedMoveDecision: null };
    }
}