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
        'container'
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
    createdDestination: OutlineNode | null
}
