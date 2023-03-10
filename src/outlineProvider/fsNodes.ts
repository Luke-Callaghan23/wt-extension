import { TreeNode } from "./outlineTreeProvider";

export type ResourceType = 'snip' | 'chapter' | 'root' | 'fragment' | 'container';
export type NodeTypes<N extends TreeNode> = RootNode<N> | SnipNode<N> | ChapterNode<N> | FragmentData | ContainerNode<N>;

export type Ids = {
    type: ResourceType,
    display: string,
    internal: string,
    relativePath: string,
    fileName: string,
    parentTypeId: ResourceType,
    parentInternalId: string,
    ordering: number
};

export type FragmentData = {
    ids: Ids,
    md: string,
};

export type ChapterNode<N extends TreeNode> = {
    ids: Ids,
    textData: N[];
    snips: N,
};

export type ContainerNode<N extends TreeNode> = {
    ids: Ids,
    contents: N[],
};

export type SnipNode<N extends TreeNode> = {
    ids: Ids,
    textData: N[]
};

export type RootNode<N extends TreeNode> = {
    ids: Ids,
    chapters: N,
    snips: N,
};