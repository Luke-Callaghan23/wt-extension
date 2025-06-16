/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../../miscTools/vsconsole';
import { OutlineTreeProvider, TreeNode } from '../../outlineProvider/outlineTreeProvider';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../../miscTools/help';
import { OutlineView } from '../outlineView';
import * as fsNodes from '../../outlineProvider/fsNodes';
import * as extension from '../../extension';
import { getChildren } from './getChildren';
import { shiftTrailingNodesDown } from './shiftTrailingNodes';
import { UriBasedView } from '../../outlineProvider/UriBasedView';
import { generalMoveNode } from './handleMovement/generalMoveNode';
import { updateChildrenToReflectNewUri } from './updateChildrenToReflectNewUri';
import { MoveNodeResult } from './handleMovement/common';

export const usedIds: { [index: string]: boolean } = {};


export type ChapterNode = fsNodes.ChapterNode<OutlineNode>;
export type ContainerNode = fsNodes.ContainerNode<OutlineNode>;
export type SnipNode = fsNodes.SnipNode<OutlineNode>;
export type RootNode = fsNodes.RootNode<OutlineNode>;
export type FragmentNode = fsNodes.FragmentNode;
export type ResourceType = fsNodes.ResourceType;
export type NodeTypes = RootNode | SnipNode | ChapterNode | FragmentNode | ContainerNode;

export class OutlineNode extends TreeNode {
    updateChildrenToReflectNewUri = updateChildrenToReflectNewUri;
    generalMoveNode = generalMoveNode;
    getChildren = getChildren;
    shiftTrailingNodesDown = shiftTrailingNodesDown;

    // Assumes this is a 'snip' or a 'fragment'
    // Traverses up the parent tree until a 'chapter' or 'root' element is found
	async getContainerParent (provider: OutlineTreeProvider<TreeNode>, searches: ResourceType[] = ['root']): Promise<OutlineNode> {
		// Traverse upwards until we find a 'chapter' or 'root' node
        // Both of these node types have a snips container within them that we can then use to store the new node
        let foundParent: OutlineNode;
        let parentUri = this.data.ids.parentUri;
        while (true) {
            foundParent = await provider.getTreeElementByUri(parentUri)! as OutlineNode;
            if (searches.includes(foundParent.data.ids.type) || foundParent.data.ids.type === 'chapter') {
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
            case 'root': return [];
            case 'container': 
                return (this.data as ContainerNode).contents
                    .sort((a, b) => a.data.ids.ordering - b.data.ids.ordering)
                    .map(content => {
                        return content.getDroppableUris();
                    }).flat();
            // Chapters and snips drop just the immediate fragment node children
            case 'chapter':
                const data = this.data as ChapterNode;
                return data.textData
                    .sort((a, b) => a.data.ids.ordering - b.data.ids.ordering)
                    .map(fragment => {
                        return fragment.getUri()
                    });
            case 'snip':
                const snip = this.data as SnipNode;
                return snip.contents
                    .sort((a, b) => a.data.ids.ordering - b.data.ids.ordering)
                    .map(content => {
                        if (content.data.ids.type === 'fragment') {
                            return content.getUri();
                        }
                        else if (content.data.ids.type === 'snip') {
                            return content.getDroppableUris();
                        }
                        return [];
                    })
                    .flat();
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
