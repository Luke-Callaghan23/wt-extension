import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from "../../../help";
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../outlineNode";
import { OutlineView } from '../../outlineView';
import * as extension from '../../../extension';
import { Workspace } from '../../../workspace/workspaceClass';
import { MoveNodeResult, allowedMoves } from './common';
import { handleInternalContainerReorder } from './handleInternalReorder';
import { determineDestinationContainer } from './determineDestinationContainer';
import { handleContainerSwap } from './containerSwap';
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { handleContainerSourceMove } from './sourceContainerMove';



export async function generalMoveNode (
    this: OutlineNode,
    operation: 'move' | 'recover',
    newParent: TreeNode, 
    recycleView: UriBasedView<OutlineNode>,
    outlineView: OutlineTreeProvider<TreeNode>,
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
        return handleContainerSourceMove(operation, this, recycleView, outlineView, newParent, moveOffset);
    }
    

    const destinationResult = await determineDestinationContainer(
        moverType, newParentType, 
        outlineView, newParent, 
        newParentNode, newParentUri, 
        overrideDestination
    );
    if (destinationResult === null) return { moveOffset: -1, effectedContainers: [], createdDestination: null };
    const { destinationContainer, newOverride } = destinationResult;


    if (operation === 'recover') {
        const swapResult = await handleContainerSwap('recover', this, outlineView, recycleView, destinationContainer);
        return { 
            moveOffset: swapResult.moveOffset, 
            createdDestination: newOverride || null,
            effectedContainers: swapResult.effectedContainers 
        };
    }

    // If the container of the destination is the same as the container of the mover, then we're 
    //      not actually moving the node anywhere, we are just changing the internal ordering
    // This is an entirely separate set of logic than moving to a different container
    if (destinationContainer.getUri().toString() === moverParentUri.toString()) {
        return await handleInternalContainerReorder(this, destinationContainer, newParentNode, moveOffset);
    }

    try {
        const swapResult = await handleContainerSwap(
            operation, this, 
            outlineView, outlineView as any as UriBasedView<OutlineNode>,
            destinationContainer
        );
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