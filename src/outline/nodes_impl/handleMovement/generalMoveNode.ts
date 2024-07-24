import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { compareFsPath, ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from "../../../miscTools/help";
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../outlineNode";
import { OutlineView } from '../../outlineView';
import * as extension from '../../../extension';
import { Workspace } from '../../../workspace/workspaceClass';
import { DestinationResult, MoveNodeResult, allowedMoves } from './common';
import { handleInternalContainerReorder } from './handleInternalReorder';
import { determineDestinationContainer } from './determineDestinationContainer';
import { handleContainerSwap } from './containerSwap';
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { containerMove } from './containerMove';
import { chapterMove } from './chapterMove';



export async function generalMoveNode (
    this: OutlineNode,
    operation: 'move' | 'recover' | 'scratch',
    newParent: TreeNode, 
    recycleView: UriBasedView<OutlineNode>,
    outlineView: OutlineTreeProvider<TreeNode>,
    moveOffset: number,
    overrideDestination: TreeNode | null,
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
): Promise<MoveNodeResult> {
    const newParentNode = newParent as OutlineNode;
    const newParentType = newParentNode.data.ids.type;
    const newParentUri = newParentNode.data.ids.uri;
    
    const moverType = this.data.ids.type;
    const moverParentUri = this.data.ids.parentUri;
    
    const thisAllowedMoves = allowedMoves[moverType];
    if (!thisAllowedMoves.find(allowed => allowed === newParentType)) {
        return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };
    }

    let chapterDestination: DestinationResult | undefined;
    if (moverType === 'container') {
        if (operation === 'scratch') throw 'unreachable';
        return containerMove(operation, this, recycleView, outlineView, newParent, moveOffset);
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
    if (destinationResult === null) return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };
    const { destinationContainer, newOverride, rememberedMoveDecision: moveDecision } = destinationResult;


    if (operation === 'recover') {
        const swapResult = await handleContainerSwap('recover', this, outlineView, recycleView, destinationContainer, moveDecision);
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
    if (compareFsPath(destinationContainer.getUri(), moverParentUri)) {
        return handleInternalContainerReorder(this, destinationContainer, newParentNode, moveOffset, rememberedMoveDecision);
    }

    try {
        const swapResult = await handleContainerSwap(
            operation, this, 
            outlineView, outlineView as any as UriBasedView<OutlineNode>,
            destinationContainer,
            moveDecision
        );

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