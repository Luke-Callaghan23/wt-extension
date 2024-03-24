import * as vscode from 'vscode';
import { TreeNode } from "./outlineTreeProvider";

export type ResourceType = 'snip' | 'chapter' | 'root' | 'fragment' | 'container';
export type NodeTypes<N extends TreeNode> = RootNode<N> | SnipNode<N> | ChapterNode<N> | FragmentNode | ContainerNode<N>;

export type Ids = {
    type: ResourceType;
    display: string;
    uri: vscode.Uri;
    relativePath: string;
    fileName: string;
    parentTypeId: ResourceType;
    parentUri: vscode.Uri;
    ordering: number;
};

export type FragmentNode = {
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
    contents: N[]
};

export type RootNode<N extends TreeNode> = {
    ids: Ids,
    chapters: N,
    snips: N,
};