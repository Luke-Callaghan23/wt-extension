import * as vscode from 'vscode';
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../outlineNode";
import { ChapterMoveResult, MoveNodeResult } from "./common";
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { newSnip } from '../../impl/createNodes';
import { OutlineView } from '../../outlineView';
import { isSubdirectory } from '../../../miscTools/help';
import { Extension } from '../../../extension';




export async function chapterMove (
    operation: 'move' | 'recover' | 'paste',
    node: OutlineNode,
    recycleView: UriBasedView<OutlineNode>,
    outlineView: OutlineTreeProvider<TreeNode>,
    newParentType: ResourceType,
    newParent: OutlineNode, 
    off: number,
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
): Promise<ChapterMoveResult | null> {
    
    // First determine an actual destination of the chapter after the move
    // There are two valid-by-default options for moves:
    //      reorders inside of the same chapter group
    //      moves to a different chapter group
    // The other valid moves involve translating the chapter contents into a
    //      snip and then copying them into a snip container (or a snip itself)
    // If this is a valid-by-default move, this function will exit early in the maze of if statements
    //      below
    // If not, it will assign values to `destinationParent` and `destinationContents` and the 
    //      function will ask the user to confirm chapter-to-snip translation
    
    let destinationParent: OutlineNode | undefined;
    let destinationContents: OutlineNode[] | undefined;

    if (newParentType === 'container') {
        // If the new parent is a container it is either:
        //      1) one of the chapter groups
        //      2) the work snips container
        //      3) a snips container inside of chapter
        const grandparentTypeId = newParent.data.ids.parentTypeId; 
        if (grandparentTypeId === 'container') {
            // Parent is a 1) chapter group container -- this is a standard move operation and we can return early 
            //      with the destination as parent we recieved
            return {
                kind: 'destination',
                result: {
                    destinationContainer: newParent,
                    newOverride: null,
                    rememberedMoveDecision: rememberedMoveDecision,
                }
            };
        }
        else if (grandparentTypeId === 'root') {
            // Parent is the 2) work snips container -- we convert this chapter to a snip
            destinationParent = newParent;
            destinationContents = (newParent.data as ContainerNode).contents;
        }
        else if (grandparentTypeId === 'chapter') {
            // The destination is a 3) snips container inside of a chapter -- we convert this chapter to a snip
            const newGrandparentUri = newParent.data.ids.parentUri;
            const newGrandparent: OutlineNode = await outlineView.getTreeElementByUri(newGrandparentUri)! as OutlineNode;
            destinationParent = (newGrandparent.data as ChapterNode).snips;
            destinationContents = ((newGrandparent.data as ChapterNode).snips.data as ContainerNode).contents;
        }
        else throw `Unexpected parent-parent type: ${grandparentTypeId}`;
    }
    else if (newParentType === 'chapter') {

        // If the destination is a chapter, we need to find the chapter group that it belongs to, and use that container as the 
        //      the new destination of this chapter
        const grandParentUri = newParent.data.ids.parentUri;
        const grandParent = await outlineView.getTreeElementByUri(grandParentUri);
        if (!grandParent) {
            vscode.window.showErrorMessage(`Could not find the parent chapter group of '${newParent.data.ids.uri}'`);
            throw `Could not find the parent chapter group of '${newParent.data.ids.uri}'`;
        }

        const grandParentNode = (grandParent as OutlineNode);
        return {
            kind: 'destination',
            result: {
                destinationContainer: grandParentNode,
                newOverride: null,
                rememberedMoveDecision: rememberedMoveDecision,
            }
        } 
    }
    else if (newParentType === 'snip') {
        destinationParent = newParent;
        destinationContents = (newParent.data as SnipNode).contents;
    }
    else if (newParentType === 'fragment') {
        const newGrandparentUri = newParent.data.ids.parentUri;
        const newGrandparent: OutlineNode = await outlineView.getTreeElementByUri(newGrandparentUri)! as OutlineNode;

        // If the fragment is one of the text fragments of a chapter, then move this chapter into that chapter's
        //      snip container
        if (newParent.data.ids.parentTypeId === 'chapter') {
            destinationParent = (newGrandparent.data as ChapterNode).snips;
            destinationContents = ((newGrandparent.data as ChapterNode).snips.data as ContainerNode).contents;
        }
        // If the fragment is child of a snip, then use that snip as the destination
        else if (newParent.data.ids.parentTypeId === 'snip') {
            destinationParent = newGrandparent;
            destinationContents = (newGrandparent.data as SnipNode).contents;
        }
        else throw `Unexpected parent parent type: ${newParent.data.ids.parentTypeId}`;
    }
    else throw `Unexpected parent type: ${newParentType}`;

    // If we've made it this far, and did not exit in the maze of ifs above, then the destination node
    //      for this chapter is not a valid-by-default direct move and we need to conver the chapter into
    //      a snip to complete the desired move
    
    // First confirm that we have a valid destination and contents
    if (destinationParent === undefined || destinationContents === undefined) {
        throw `Could not find destination contents`;
    }

    // Confirm with the user that the conversion is okay
    const chapterNode = node.data as ChapterNode;    
    const conversionResponse = await vscode.window.showInformationMessage(`Are you sure you want to convert chapter '${chapterNode.ids.display}' into a snip?  This is an irreversible operation.`, { modal: true }, "Yes", "No");
    if (conversionResponse === 'No' || conversionResponse === undefined) {
        return null;
    }

    // Proceed to convert 

    // To convert the above content into a snip, we need to make a new snip to represent the chapter
    const chapterSnipUri = await (outlineView as OutlineView).newSnip(destinationParent, {
        defaultName: chapterNode.ids.display,
        preventRefresh: true,
        skipFragment: true,
    });
    if (chapterSnipUri === null) return null;
    const chapterSnip = await outlineView.getTreeElementByUri(chapterSnipUri)! as OutlineNode;
    
    // Then move every single fragment from the original chapter into the new snip
    let acc = 0;
    const moveFragments: OutlineNode[] = [...chapterNode.textData];                                 // Need to copy into a new array because we're moving content in the loops below -- when moved, we'll skip every other one
    for (const moveFragment of moveFragments) {
        const moveResult = await moveFragment.moveNode(
            operation, chapterSnip, 
            recycleView, outlineView,
            off, null,
            rememberedMoveDecision,
        );
        if (!moveResult) return null;
    }

    // Then create a snip inside of the newly created snip to represent the snips container of the moved chapter
    const chapterSnipContainerUri = await (outlineView as OutlineView).newSnip(chapterSnip, {
        defaultName: 'Snips',
        preventRefresh: true,
        skipFragment: true,
    });
    if (chapterSnipContainerUri === null) return null;
    const chapterSnipContainer = await outlineView.getTreeElementByUri(chapterSnipContainerUri)! as OutlineNode;

    // Then move every single snip from the moved chapter into the converted snip's snip container
    acc = 0;
    const moveSnips: OutlineNode[] = [...(chapterNode.snips.data as ContainerNode).contents];
    for (const moveSnip of moveSnips) {
        const moveResult = await moveSnip.moveNode(
            operation, chapterSnipContainer, 
            recycleView, outlineView, 
            off, null, rememberedMoveDecision
        );
        if (!moveResult) return null;
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

    return { 
        kind: 'move',
        result: { moveOffset: acc, createdDestination: null, effectedContainers: [ (outlineView.rootNodes[0] as OutlineNode) ], rememberedMoveDecision }
    };
};