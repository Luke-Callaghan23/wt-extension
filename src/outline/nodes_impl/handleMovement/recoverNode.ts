import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { getLatestOrdering, readDotConfig, writeDotConfig } from "../../../help";
import {  OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../../node";
import { OutlineView } from '../../outlineView';
import { RecyclingBinView } from '../../../recyclingBin/recyclingBinView';
import { getUsableFileName } from '../../impl/createNodes';
import { MoveNodeResult, allowedMoves } from './common';
import { determineDestinationContainer } from './determineDestinationContainer';
import { handleContainerSwap } from './containerSwap';
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { handleContainerSourceMove } from './sourceContainerMove';


export async function recoverNode (
    this: OutlineNode,
    newParent: TreeNode, 
    recycleView: UriBasedView<OutlineNode>,
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
        return handleContainerSourceMove('recover', this, recycleView, outlineView, newParent, 0);
    }

    // If the mover is not a container, then we're only moving a single item:
    const destinationResult = await determineDestinationContainer(
        moverType, newParentType, 
        outlineView, newParent, 
        newParentNode, newParentUri, 
        overrideDestination
    );
    if (destinationResult === null) return { moveOffset: -1, effectedContainers: [], createdDestination: null };
    const { destinationContainer, newOverride } = destinationResult;

    // If the container of the destination is the same as the container of the mover, then we're 
    //      not actually moving the node anywhere, we are just changing the internal ordering
    // This is an entirely separate set of logic than moving to a different container
    const swapResult = await handleContainerSwap('recover', this, outlineView, recycleView, destinationContainer);
    return { 
        moveOffset: swapResult.moveOffset, 
        createdDestination: newOverride || null,
        effectedContainers: swapResult.effectedContainers 
    };
}