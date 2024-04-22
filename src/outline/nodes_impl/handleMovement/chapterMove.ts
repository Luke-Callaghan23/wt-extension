import * as vscode from 'vscode';
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, ResourceType, RootNode, SnipNode } from "../outlineNode";
import { ChapterMoveResult, MoveNodeResult } from "./common";
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { newSnip } from '../../impl/createNodes';
import { OutlineView } from '../../outlineView';




export async function chapterMove (
    operation: 'move' | 'recover',
    node: OutlineNode,
    recycleView: UriBasedView<OutlineNode>,
    outlineView: OutlineTreeProvider<TreeNode>,
    newParentType: ResourceType,
    newParent: OutlineNode, 
    off: number,
): Promise<ChapterMoveResult> {

    let destinationParent: OutlineNode | undefined;
    let destinationContents: OutlineNode[] | undefined;
    
    if (newParentType === 'container') {
        const grandparentTypeId = newParent.data.ids.parentTypeId; 
        if (grandparentTypeId === 'root') {
            return {
                kind: 'destination',
                result: {
                    destinationContainer: ((outlineView.rootNodes[0] as OutlineNode).data as RootNode).chapters,
                    newOverride: null,
                }
            };
        }
        else if (grandparentTypeId === 'chapter') {
            const newGrandparentUri = newParent.data.ids.parentUri;
            const newGrandparent: OutlineNode = await outlineView.getTreeElementByUri(newGrandparentUri);
            destinationParent = (newGrandparent.data as ChapterNode).snips;
            destinationContents = ((newGrandparent.data as ChapterNode).snips.data as ContainerNode).contents;
        }
        else throw `Unexpected parent-parent type: ${grandparentTypeId}`;
    }
    else if (newParentType === 'chapter') {
        return {
            kind: 'destination',
            result: {
                destinationContainer: ((outlineView.rootNodes[0] as OutlineNode).data as RootNode).chapters,
                newOverride: null,
            }
        } 
    }
    else if (newParentType === 'snip') {
        destinationParent = newParent;
        destinationContents = (newParent.data as SnipNode).contents;
    }
    else if (newParentType === 'fragment') {
        const newGrandparentUri = newParent.data.ids.parentUri;
        const newGrandparent: OutlineNode = await outlineView.getTreeElementByUri(newGrandparentUri);
        if (newParent.data.ids.parentTypeId === 'chapter') {
            destinationParent = (newGrandparent.data as ChapterNode).snips;
            destinationContents = ((newGrandparent.data as ChapterNode).snips.data as ContainerNode).contents;
        }
        else if (newParent.data.ids.parentTypeId === 'snip') {
            destinationParent = newGrandparent;
            destinationContents = (newGrandparent.data as SnipNode).contents;
        }
        else throw `Unexpected parent parent type: ${newParent.data.ids.parentTypeId}`;
    }
    else throw `Unexpected parent type: ${newParentType}`;

    if (destinationParent === undefined || destinationContents === undefined) {
        throw `Could not find destination contents`;
    }

    
    const chapterNode = node.data as ChapterNode;    
    const result = await vscode.window.showInformationMessage(`Are you sure you want to convert chapter '${chapterNode.ids.display}' into a snip?  This is an irreversible operation.  (And it takes quite a while).`, { modal: true }, "Yes", "No");
    if (result === 'No' || result === undefined) {
        return { kind: 'move', result: { moveOffset: -1, effectedContainers: [], createdDestination: null } };
    }
    
    // To convert the above content into a snip, we need to make a new snip to represent the chapter
    const chapterSnipUri = await (outlineView as OutlineView).newSnip(destinationParent, {
        defaultName: chapterNode.ids.display,
        preventRefresh: true,
        skipFragment: true,
    });
    if (chapterSnipUri === null) return { kind: 'move', result: { moveOffset: -1, effectedContainers: [], createdDestination: null } };
    const chapterSnip = await outlineView.getTreeElementByUri(chapterSnipUri);
    
    
    // Then move every single fragment from the original chapter into the new snip
    let acc = 0;
    const moveFragments: OutlineNode[] = [...chapterNode.textData];                                 // Need to copy into a new array because we're moving content in the loops below -- when moved, we'll skip every other one
    for (const moveFragment of moveFragments) {
        let { moveOffset, createdDestination, effectedContainers } = await moveFragment.generalMoveNode(
            operation, chapterSnip, 
            recycleView, outlineView,
            off, null
        );
        if (moveOffset === -1) return { kind: 'move', result: { moveOffset: -1, effectedContainers: [], createdDestination: null } };
    }

    // Then create a snip inside of the newly created snip to represent the snips container of the moved chapter
    const chapterSnipContainerUri = await (outlineView as OutlineView).newSnip(chapterSnip, {
        defaultName: 'Snips',
        preventRefresh: true,
        skipFragment: true,
    });
    if (chapterSnipContainerUri === null) return { kind: 'move', result: { moveOffset: -1, effectedContainers: [], createdDestination: null } };
    const chapterSnipContainer = await outlineView.getTreeElementByUri(chapterSnipContainerUri);

    // Then move every single snip from the moved chapter into the converted snip's snip container
    acc = 0;
    const moveSnips: OutlineNode[] = [...(chapterNode.snips.data as ContainerNode).contents];
    for (const moveSnip of moveSnips) {
        let { moveOffset, createdDestination, effectedContainers } = await moveSnip.generalMoveNode(
            operation, chapterSnipContainer, 
            recycleView, outlineView, 
            off, null
        );
        if (moveOffset === -1) return { kind: 'move', result: { moveOffset: -1, effectedContainers: [], createdDestination: null } };
    }

    // Remove the trace of the old chapter from the file system
    // Remove it from the config file
    await node.shiftTrailingNodesDown(outlineView);
    const chapterNodeUri = node.getUri();
    // Remove it from the file system itself
    await vscode.workspace.fs.delete(chapterNodeUri, {
        recursive: true,
        useTrash: false
    });

    return { 
        kind: 'move',
        result: { moveOffset: acc, createdDestination: null, effectedContainers: [ (outlineView.rootNodes[0] as OutlineNode) ] }
    };
};