/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../vsconsole';
import { MoveNodeResult, OutlineTreeProvider, TreeNode } from '../outlineProvider/outlineTreeProvider';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../help';
import { OutlineView } from './outlineView';
import * as fsNodes from '../outlineProvider/fsNodes';
import * as extension from '../extension';
import { moveNode as _moveNode } from './nodes_impl/moveNode';
import { getChildren as _getChildren } from './nodes_impl/getChildren';
import { shiftTrailingNodesDown as _shiftTrailingNodesDown } from './nodes_impl/shiftTrailingNodes';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import { recoverNode } from './impl/recoverNode';

export const usedIds: { [index: string]: boolean } = {};


export type ChapterNode = fsNodes.ChapterNode<OutlineNode>;
export type ContainerNode = fsNodes.ContainerNode<OutlineNode>;
export type SnipNode = fsNodes.SnipNode<OutlineNode>;
export type RootNode = fsNodes.RootNode<OutlineNode>;
export type FragmentNode = fsNodes.FragmentNode;
export type ResourceType = fsNodes.ResourceType;
export type NodeTypes = RootNode | SnipNode | ChapterNode | FragmentNode | ContainerNode;

export class OutlineNode extends TreeNode {

    async moveNode (
        newParent: TreeNode, 
        provider: OutlineTreeProvider<TreeNode>,
        moveOffset: number,
        overrideDestination: TreeNode | null
    ): Promise<MoveNodeResult> {
        return _moveNode.bind(this)(newParent, provider, moveOffset, overrideDestination);
    }

    recoverNode = recoverNode;
    async getChildren (filter: boolean): Promise<OutlineNode[]> {
        return _getChildren.bind(this)(filter);
    }


    async shiftTrailingNodesDown (view: UriBasedView<TreeNode>): Promise<string> {
        return _shiftTrailingNodesDown.bind(this)(view);
    }

    // Assumes this is a 'snip' or a 'fragment'
    // Traverses up the parent tree until a 'chapter' or 'root' element is found
	async getContainerParent (provider: OutlineTreeProvider<TreeNode>, secondary: string = 'root'): Promise<OutlineNode> {
		// Traverse upwards until we find a 'chapter' or 'root' node
        // Both of these node types have a snips container within them that we can then use to store the new node
        let foundParent: OutlineNode;
        let parentUri = this.data.ids.parentUri;
        while (true) {
            foundParent = await provider.getTreeElementByUri(parentUri);
            if (foundParent.data.ids.type === secondary || foundParent.data.ids.type === 'chapter') {
                break;
            }
            parentUri = foundParent.data.ids.parentUri;
        }

        // Convert the root or chapter parent to a more declarative type, and return the snips container
        return foundParent;
	}

    getParentUri(): vscode.Uri {
        return this.data.ids.parentUri;
    }

    getTooltip (): string | vscode.MarkdownString {
        return `${this.data.ids.type} | '${this.data.ids.display}'`;
    }
    
    hasChildren (): boolean {
        return this.data.ids.type !== 'fragment';
    }

    getUri(): vscode.Uri {
        return this.data.ids.uri;
    }
    getDisplayString (): string {
        return this.data.ids.display;
    }

    getDroppableUris(): vscode.Uri[] {
        switch (this.data.ids.type) {
            // Root and containers cannot drop any uris
            case 'root': case 'container': return [];
            // Chapters and snips drop just the immediate fragment node children
            case 'chapter': case 'snip':
                const data = this.data as ChapterNode | SnipNode;
                return data.textData
                    .sort((a, b) => a.data.ids.ordering - b.data.ids.ordering)
                    .map(fragment => {
                        return fragment.getUri()
                    });
            // Fragments drop themselves
            case 'fragment':
                return [ this.getUri() ];
        }
    }

    data: NodeTypes;

    constructor(data: NodeTypes) {
        super();
        this.data = data;
    }
}
