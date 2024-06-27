import { TreeNode } from "../../../outlineProvider/outlineTreeProvider";
import { OutlineNode, ResourceType } from "../outlineNode";

// Map of a resource type to all resource types that the key can be moved into
export const allowedMoves: { [index: string]: ResourceType[] } = {
    'snip': [
        'chapter',
        'fragment',
        'root',
        'container',
        'snip'
    ],
    'chapter': [
        'chapter',
        'container',
        'snip',
        'fragment',
    ],
    'root': [],
    'container': [
        'chapter',
        'root',
        'snip',
        'container',
        'fragment'
    ],
    'fragment': [
        'chapter',
        'snip',
        'fragment',
        'container'
    ],
};

export type MoveNodeResult = {
    moveOffset: number,
    effectedContainers: OutlineNode[],
    createdDestination: OutlineNode | null,
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
}

export type DestinationResult = {
    destinationContainer: OutlineNode;
    newOverride: OutlineNode | null;
    rememberedMoveDecision: 'Reorder' | 'Insert' | null
}

export type ChapterMoveResult = {
    kind: 'move',
    result: MoveNodeResult
} | {
    kind: 'destination',
    result: DestinationResult
};
