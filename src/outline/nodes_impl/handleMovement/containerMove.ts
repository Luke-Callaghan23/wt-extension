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
): Promise<MoveNodeResult> {
    // If the moving item is a container, it must be a snip container
    // Check to make sure that the type of the first child of the container is a snip
    const moverNode = node.data as ContainerNode;
    const moverContent: OutlineNode[] = moverNode.contents;
    if (moverContent.length === 0 || moverContent[0].data.ids.type === 'chapter') {
        throw new Error('Not possible');
    }
    
    // Find the target where the snip should move into
    let containerTarget: TreeNode;
    containerTarget = newParent;
    
    // Create shallow copy of all snips because removing nodes from the 
    //      original `contents` array (which is what `moveNode` does)
    //      will cause skipping of some nodes otherwise
    const snips = [ ...moverContent ];
    
    const effectedContainersUriMap: {
        [index: string]: OutlineNode,
    } = {};

    // Move each snip one by one
    let acc = 0;
    for (const snip of snips) {
        let { moveOffset, createdDestination, effectedContainers } = await snip.generalMoveNode(
            operation,
            containerTarget, 
            recycleView,
            outlineView,
            off,
            null,
            'Insert'
        );
        if (moveOffset === -1) return { moveOffset: -1, effectedContainers: [], createdDestination: null, rememberedMoveDecision: null };
        acc += moveOffset;

        for (const container of effectedContainers) {
            setFsPathKey<OutlineNode>(container.getUri(), container, effectedContainersUriMap);
        }
    }
    
    const allEffectedContainers = Object.entries(effectedContainersUriMap)
        .map(([ _, container ]) => container);
    return { moveOffset: acc, createdDestination: null, effectedContainers: allEffectedContainers, rememberedMoveDecision: null };
};