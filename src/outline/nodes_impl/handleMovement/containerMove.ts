import * as vscode from 'vscode';
import { OutlineTreeProvider, TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { ContainerNode, OutlineNode, ResourceType } from "../outlineNode";
import { MoveNodeResult } from "./common";
import { UriBasedView } from '../../../outlineProvider/UriBasedView';
import { setFsPathKey } from '../../../miscTools/help';



export async function containerMove (
    operation: 'move' | 'recover' | 'paste',
    node: OutlineNode,
    recycleView: UriBasedView<OutlineNode>,
    outlineView: OutlineTreeProvider<TreeNode>,
    newParent: TreeNode, 
    off: number,
): Promise<MoveNodeResult | null> {
    const containerNode = node.data as ContainerNode;
    const containerContent: OutlineNode[] = containerNode.contents;
    if (containerContent.length === 0) {
        vscode.window.showWarningMessage(`[WARN] Cannot move container node '${containerNode.ids.display}' with 0 children.  Skipping . . . `);
        return {
            createdDestination: null,
            moveOffset: off,
            effectedContainers: [],
            rememberedMoveDecision: null,
        };
    }
    
    const containerContentType = containerContent[0].data.ids.type;
    
    // If the moving item is a container, it must be a snip container or a chapter group
    // Check to make sure that the type of the first child of the container is a chapter
    //      or a snip
    // These are the only valid moves for a container
    if (containerContentType !== 'chapter' && containerContentType !== 'snip') {
        vscode.window.showWarningMessage(`[WARN] Cannot move container node '${containerNode.ids.display}' with 0 children.  Skipping . . . `);
        return {
            createdDestination: null,
            moveOffset: off,
            effectedContainers: [],
            rememberedMoveDecision: null,
        };
    }
    
    const destinationContainer: TreeNode = newParent;

    // Create shallow copy of all snips because removing nodes from the 
    //      original `contents` array (which is what `moveNode` does)
    //      will cause skipping of some nodes otherwise
    const contentArray = [ ...containerContent ];
    
    const effectedContainersUriMap: {
        [index: string]: OutlineNode,
    } = {};

    let acc = 0;
    // Move each chapter or snip one by one
    for (const chapterOrSnip of contentArray) {
        const moveResult = await chapterOrSnip.moveNode(
            operation,
            destinationContainer, 
            recycleView,
            outlineView,
            off,
            null,
            'Insert'
        );
        if (!moveResult) return null;
        
        let { moveOffset, createdDestination, effectedContainers } = moveResult;
        acc += moveOffset;

        for (const container of effectedContainers) {
            setFsPathKey<OutlineNode>(container.getUri(), container, effectedContainersUriMap);
        }
    }
    
    const allEffectedContainers = Object.entries(effectedContainersUriMap)
        .map(([ _, container ]) => container);
    return { moveOffset: acc, createdDestination: null, effectedContainers: allEffectedContainers, rememberedMoveDecision: null };
};