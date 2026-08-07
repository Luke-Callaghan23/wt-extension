import * as vscode from 'vscode';
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../outlineNode";
import { ChapterMoveResult, MoveNodeResult } from "./common";
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { newSnip } from '../../impl/createNodes';
import { OutlineView } from '../../outlineView';
import { compareFsPath, isSubdirectory } from '../../../miscTools/help';
import { Extension } from '../../../extension';

async function convertChapterToSnip (
    operation: 'move' | 'recover' | 'paste',
    node: OutlineNode,
    recycleView: UriBasedView<OutlineNode>,
    outlineView: OutlineTreeProvider<TreeNode>,
    off: number,
    rememberedMoveDecision: 'Reorder' | 'Insert' | null,
    destinationParent: OutlineNode,
) {
    const chapterNode = node.data as ChapterNode;    
    const result = await vscode.window.showInformationMessage(`Are you sure you want to convert chapter '${chapterNode.ids.display}' into a snip?  This is an irreversible operation.  (And it takes quite a while).`, { modal: true }, "Yes", "No");
    if (result === 'No' || result === undefined) {
        return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };
    }
    
    // To convert the above content into a snip, we need to make a new snip to represent the chapter
    const chapterSnipUri = await (outlineView as OutlineView).newSnip(destinationParent, {
        defaultName: chapterNode.ids.display,
        preventRefresh: true,
        skipFragment: true,
    });
    if (chapterSnipUri === null) return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };
    const chapterSnip = await outlineView.getTreeElementByUri(chapterSnipUri)! as OutlineNode;
    
    
    // Then move every single fragment from the original chapter into the new snip
    let acc = 0;
    const moveFragments: OutlineNode[] = [...chapterNode.textData];                                 // Need to copy into a new array because we're moving content in the loops below -- when moved, we'll skip every other one
    for (const moveFragment of moveFragments) {
        let { moveOffset, createdDestination, effectedContainers } = await moveFragment.moveNode(
            operation, chapterSnip, 
            recycleView, outlineView,
            off, null,
            rememberedMoveDecision,
        );
        if (moveOffset === -1) return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };
    }

    // Then create a snip inside of the newly created snip to represent the snips container of the moved chapter
    const chapterSnipContainerUri = await (outlineView as OutlineView).newSnip(chapterSnip, {
        defaultName: 'Snips',
        preventRefresh: true,
        skipFragment: true,
    });
    if (chapterSnipContainerUri === null) return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };
    const chapterSnipContainer = await outlineView.getTreeElementByUri(chapterSnipContainerUri)! as OutlineNode;

    // Then move every single snip from the moved chapter into the converted snip's snip container
    acc = 0;
    const moveSnips: OutlineNode[] = [...(chapterNode.snips.data as ContainerNode).contents];
    for (const moveSnip of moveSnips) {
        let { moveOffset, createdDestination, effectedContainers } = await moveSnip.moveNode(
            operation, chapterSnipContainer, 
            recycleView, outlineView, 
            off, null, rememberedMoveDecision
        );
        if (moveOffset === -1) return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };
    }

    if (operation !== 'paste') {
        // Remove the trace of the old chapter from the file system
        // Remove it from the config file
        await node.shiftTrailingNodesDown(outlineView);
        const chapterNodeUri = node.getUri();
        // Remove it from the file system itself
        await vscode.workspace.fs.delete(chapterNodeUri, {
            recursive: true,
            useTrash: false
        });
    }

    return { moveOffset: acc, createdDestination: null, effectedContainers: [ (outlineView.rootNodes[0] as OutlineNode) ], rememberedMoveDecision };
}

// Three essential kinds of chapter moves:
//      1) Moving the chapter within its own chapter group
//          - simple to deal with, just change the ordering values in .config and outline provider structure
//      2) Moving the chapter from one chapter group into another
//          - relatively simple, just change delete/add entries in each .config, update internal structure, and rename the folders
//      3) Converting the chapter into a snip
//          - complicated, requires creating all new files for each file within the chapter
export async function chapterMove (
    operation: 'move' | 'recover' | 'paste',
    node: OutlineNode,
    recycleView: UriBasedView<OutlineNode>,
    outlineView: OutlineTreeProvider<TreeNode>,
    newParentType: ResourceType,
    newParent: OutlineNode, 
    off: number,
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
): Promise<MoveNodeResult> {

    // Scenario 1: reorder the chapters within the same chapter group


    // Scenario 2: move chapter from one chapter group to another


    // Scenario 3: convert chapter to snip
    // First, find the actual destination location where the chapter will end up

    let destinationParent: OutlineNode | undefined;
    if (newParentType === 'container') {
        const grandparentTypeId = newParent.data.ids.parentTypeId; 
        if (grandparentTypeId === 'chapter') {
            const newGrandparentUri = newParent.data.ids.parentUri;
            const newGrandparent: OutlineNode = await outlineView.getTreeElementByUri(newGrandparentUri)! as OutlineNode;
            destinationParent = (newGrandparent.data as ChapterNode).snips;
        }
        else throw `Unexpected parent-parent type: ${grandparentTypeId}`;
    }
    else if (newParentType === 'snip') {
        destinationParent = newParent;
    }
    else if (newParentType === 'fragment') {
        const newGrandparentUri = newParent.data.ids.parentUri;
        const newGrandparent: OutlineNode = await outlineView.getTreeElementByUri(newGrandparentUri)! as OutlineNode;
        if (newParent.data.ids.parentTypeId === 'chapter') {
            destinationParent = (newGrandparent.data as ChapterNode).snips;
        }
        else if (newParent.data.ids.parentTypeId === 'snip') {
            destinationParent = newGrandparent;
        }
        else throw `Unexpected parent parent type: ${newParent.data.ids.parentTypeId}`;
    }
    else throw `Unexpected parent type: ${newParentType}`;

    if (destinationParent === undefined) {
        throw `Could not find destination contents`;
    }

    // Do all the fs operations / internal structure updates to recreate the chapter as a snip
    return convertChapterToSnip(operation, node, recycleView, outlineView, off, rememberedMoveDecision, destinationParent);
};