import * as vscode from 'vscode';
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../outlineNode";
import { OutlineView } from "../../outlineView";
import { DestinationResult } from './common';



export async function determineDestinationContainer (
    mover: TreeNode,
    moverType: ResourceType,
    newParentType: ResourceType,
    provider: OutlineTreeProvider<TreeNode>,
    newParent: TreeNode, 
    newParentNode: OutlineNode,
    newParentUri: vscode.Uri,
    overrideDestination: TreeNode | null,
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
): Promise<DestinationResult | null> {

    let newOverride: OutlineNode | undefined;
    let destinationContainer: OutlineNode;
    if (moverType === 'snip') {
        // Use the root's .snips container
        if (newParentType === 'root') {
            const root: RootNode = (provider.rootNodes[0] as OutlineNode).data as RootNode;
            destinationContainer = (root.snips as OutlineNode);
        }
        // Use the chapter's .snips container
        else if (newParentType === 'chapter') {
            const chapterNode: ChapterNode = (await provider.getTreeElementByUri(newParentUri)! as OutlineNode).data as ChapterNode;
            destinationContainer = chapterNode.snips;
        }
        // Traverse upwards until we find the nearest 'root' or 'chapter' node that we can move the snip into
        else if (newParentType === 'container' || newParentType === 'fragment') {
            const parentContainer = await newParentNode.getContainerParent(provider, ['root', 'snip']);
            const parentContainerNode = parentContainer.data as ChapterNode | RootNode | SnipNode;
            if (parentContainerNode.ids.type === 'chapter'  || parentContainer.data.ids.type === 'root') {
                destinationContainer = (parentContainerNode as ChapterNode | RootNode).snips;
            }
            else if (parentContainerNode.ids.type === 'snip') {
                destinationContainer = parentContainer;
            }
            else throw `unreachable`;
        }
        else if (newParentType === 'snip') {
            if (mover.getParentUri().fsPath === newParentNode.getParentUri().fsPath) {

                const moverON = mover as OutlineNode;
                const npnON = newParentNode as OutlineNode;

                // When mover type is a snip and destination is a snip and they are both in the same container,
                //      then we need to determine if the user wants to nest the mover inside of the target
                //      or if they were intending to re-order
                const response = rememberedMoveDecision || await vscode.window.showQuickPick([ 'Reorder', 'Insert' ], {
                    canPickMany: false,
                    ignoreFocusOut: false,
                    title: `Were you intending to insert '${moverON.data.ids.display}' into '${npnON.data.ids.display}' or re-order them?`
                }) as 'Reorder' | 'Insert' | undefined;
                if (!response || response === 'Insert') {
                    destinationContainer = newParentNode; 
                    rememberedMoveDecision = 'Insert';
                }
                else {
                    destinationContainer = await provider.getTreeElementByUri(mover.getParentUri())! as OutlineNode;
                    rememberedMoveDecision = 'Reorder';
                }
            }
            else {
                destinationContainer = newParentNode;
            }
        }
        else {
            throw new Error('Not possible');
        }
    }
    else if (moverType === 'fragment') {
        if (newParentType === 'chapter' || newParentType === 'snip') {
            destinationContainer = (await provider.getTreeElementByUri(newParentUri)! as OutlineNode);
        }
        else if (newParentType === 'fragment') {
            destinationContainer = (await newParentNode.getContainerParent(provider, ['snip']));
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
                if (!snipUri) return null;

                // Get the snip node itself from the outline view 
                const snipNode = await outlineView.getTreeElementByUri(snipUri)! as OutlineNode;

                // Use that snip node as both the override for all potential future
                //      fragment moves and as the destination node
                newOverride = snipNode;
                destinationContainer = snipNode;
            }
            else return null;
        }
        else {
            throw new Error('Not possible.');
        }
    }  
    else if (moverType === 'chapter') {
        destinationContainer = ((provider.rootNodes[0] as OutlineNode).data as RootNode).chapters;
    }
    else {
        return null;
    };

    return {
        destinationContainer: destinationContainer,
        newOverride: newOverride || null,
        rememberedMoveDecision: rememberedMoveDecision,
    }
}