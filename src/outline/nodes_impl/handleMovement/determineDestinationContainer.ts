import * as vscode from 'vscode';
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, OutlineNode, ResourceType, RootNode } from "../../node";
import { OutlineView } from "../../outlineView";

export type DestinationResult = {
    destinationContainer: OutlineNode;
    newOverride: OutlineNode | null;
}

export async function determineDestinationContainer (
    moverType: ResourceType,
    newParentType: ResourceType,
    provider: OutlineTreeProvider<TreeNode>,
    newParent: TreeNode, 
    newParentNode: OutlineNode,
    newParentUri: vscode.Uri,
    overrideDestination: TreeNode | null
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
            const chapterNode: ChapterNode = (await provider.getTreeElementByUri(newParentUri)).data;
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
            destinationContainer = (await provider.getTreeElementByUri(newParentUri));
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
                if (!snipUri) return null;

                // Get the snip node itself from the outline view 
                const snipNode = await outlineView.getTreeElementByUri(snipUri);

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
    }
}