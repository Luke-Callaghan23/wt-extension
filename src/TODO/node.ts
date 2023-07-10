/* eslint-disable curly */

import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../vsconsole';
import { OutlineTreeProvider, TreeNode } from '../outlineProvider/outlineTreeProvider';
import * as fsNodes from '../outlineProvider/fsNodes';
import { Validation, TODO, TODOsView } from './TODOsView';
import * as extension from '../extension';
import { scanFragment } from './impl/scanFragment';
import { convertToTODOData } from './nodes_impl/convertFragmentNode';
import { getChildren } from './nodes_impl/getChildren';
import { getTODOCounts } from './nodes_impl/getTODOCounts';

export type ChapterNode = fsNodes.ChapterNode<TODONode>;
export type ContainerNode = fsNodes.ContainerNode<TODONode>;
export type SnipNode = fsNodes.SnipNode<TODONode>;
export type RootNode = fsNodes.RootNode<TODONode>;
export type FragmentData = fsNodes.FragmentData;
export type TODOData = {
    ids: fsNodes.Ids
    todo: TODO,
};
export type ResourceType = fsNodes.ResourceType;
export type NodeTypes = RootNode | SnipNode | ChapterNode | FragmentData | ContainerNode | TODOData;

export class TODONode extends TreeNode {

    convertToTODOData = convertToTODOData;
    getChildren = getChildren;
    getTODOCounts = getTODOCounts;

    hasChildren (): boolean {
        // A node always has children, unless if it is a leaf TODO node
        // A leaf TODO node is unique in that its own type is 'fragment' and its parent type is also 'fragment'
        return !(this.data.ids.type === 'fragment' && this.data.ids.parentTypeId === 'fragment');
    }
    
    getTooltip (): string | vscode.MarkdownString {
        return `${this.data.ids.type} | TODOs: self: ${this.data.ids.type} parent: ${this.data.ids.parentTypeId}`;
    }
    
    async moveNode (newParent: TreeNode, provider: OutlineTreeProvider<TreeNode>): Promise<number> {
        vscode.window.showErrorMessage('Error: cannot move files within the TODO tree, please try again in the outline tree');
        return -1;
    }

    getUri (): vscode.Uri {
        return this.data.ids.uri;
    }
    getDisplayString (): string {
        return this.data.ids.display;
    }

    getParentUri(): vscode.Uri {
        return this.data.ids.parentUri;
    }

    data: NodeTypes;

    constructor(data: NodeTypes) {
        super();
        this.data = data;
    }
}
