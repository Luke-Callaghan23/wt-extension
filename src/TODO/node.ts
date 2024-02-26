/* eslint-disable curly */

import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../vsconsole';
import { MoveNodeResult, OutlineTreeProvider, TreeNode } from '../outlineProvider/outlineTreeProvider';
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
export type FragmentNode = fsNodes.FragmentNode;
export type TODOData = {
    ids: fsNodes.Ids
    todo: TODO,
};
export type ResourceType = fsNodes.ResourceType;
export type NodeTypes = RootNode | SnipNode | ChapterNode | FragmentNode | ContainerNode | TODOData;

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
        
        return `${this.data.ids.type} | '${this.data.ids.display}'`;
    }
    
    async moveNode (
		newParent: TreeNode, 
		provider: OutlineTreeProvider<TreeNode>, 
		moveOffset: number,
		overrideDestination: TreeNode | null
	): Promise<MoveNodeResult> {
        vscode.window.showErrorMessage('Error: cannot move files within the TODO tree, please try again in the outline tree');
        return { moveOffset: -1 };
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

    getDroppableUris(): vscode.Uri[] {
        switch (this.data.ids.type) {
            // Root and containers cannot drop any uris
            case 'root': case 'container': return [];
            // Chapters and snips drop just the immediate fragment node children
            case 'chapter': case 'snip':
                const data = this.data as ChapterNode | SnipNode;
                return data.textData.map(fragment => {
                    return fragment.getUri()
                })
            // Fragments drop themselves
            case 'fragment':
                if (this.data.ids.parentTypeId === 'fragment') {
                    // If a child of a fragment (a TODO node) is dragged into the
                    //      editor, then open the editor to that TODO node
                    const data = this.data as TODOData;
                    const col = data.todo.colStart;
                    const line = data.todo.rowStart;
                    
                    let fragUri = this.getUri();
                    fragUri = fragUri.with({ 
                        fragment: `L${line+1},${col+1}`
                    });
                    return [ fragUri ];
                }
                else {
                    // Otherwise, if the fragment itself is dropped:
                    const children = TODOsView.getTODO(this.getUri().fsPath);
                    if (children.type === 'todos' && children.data.length === 1) {
                        // If there is only one TODO child, open that
                        const child = children.data[0];
                        const col = child.colStart;
                        const line = child.rowStart;

                        let fragUri = this.getUri();
                        fragUri = fragUri.with({ 
                            fragment: `L${line+1},${col+1}`
                        });
                        return [ fragUri ];
                    }
                    else {
                        // Otherwise, if there is more than one TODO child, 
                        //      there's no way to determine whish to open,
                        //      so just open the fragment normally
                        return [ this.getUri() ];
                    }
                }
        }
    }

    data: NodeTypes;

    constructor(data: NodeTypes) {
        super();
        this.data = data;
    }
}
