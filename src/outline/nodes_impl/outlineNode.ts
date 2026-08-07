/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../../miscTools/vsconsole';
import { OutlineTreeProvider, TreeNode } from '../../outlineProvider/outlineTreeProvider';
import { ConfigFileInfo, DotConfig, getLatestOrdering, readDotConfig, writeDotConfig } from '../../miscTools/help';
import { OutlineView } from '../outlineView';
import * as fsNodes from '../../outlineProvider/fsNodes';
import { Extension } from   '../../extension';
import { getChildren } from './getChildren';
import { shiftTrailingNodesDown } from './shiftTrailingNodes';
import { UriBasedView } from '../../outlineProvider/UriBasedView';
import { moveNode, NodeMoveKind } from './handleMovement/generalMoveNode';
import { updateChildrenToReflectNewUri } from './updateChildrenToReflectNewUri';
import { allowedMoves, MoveNodeResult } from './handleMovement/common';

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
    getChildren = getChildren;
    shiftTrailingNodesDown = shiftTrailingNodesDown;

    async duplicateInto (newContainer: OutlineNode): Promise<OutlineNode | null> {
        if (this.data.ids.type === 'root' || !allowedMoves[this.data.ids.type].includes(newContainer.data.ids.type)) {
            throw "Invalid duplication";
        }

        const destinationUri = newContainer.data.ids.uri;
        if (newContainer.data.ids.type === 'root') {
            if (this.data.ids.type === "chapter") {
                // Copy into the latest 
            }
            else if (this.data.ids.type === "container") {
                // If this is a snip container, copy all the snips into work snips
                // If this is a chapter container, copy all the chapters into a new chapter group
            }
            else if (this.data.ids.type === "fragment") {
    
            }
            else if (this.data.ids.type === "snip") {
    
            }
        }
        else if (newContainer.data.ids.type === "chapter") {

        }
        else if (newContainer.data.ids.type === "container") {

        }
        else if (newContainer.data.ids.type === "fragment") {

        }
        else if (newContainer.data.ids.type === "snip") {

        }


    }

    async updateUriCascaseChanges (newUri: vscode.Uri) {
        throw "not implemented";
    }

    async moveNode (
        operation: NodeMoveKind,
        newParent: TreeNode, 
        recycleView: UriBasedView<OutlineNode>,
        outlineView: OutlineTreeProvider<TreeNode>,
        moveOffset: number,
        overrideDestination: TreeNode | null,
        rememberedMoveDecision: 'Reorder' | 'Insert' | null
    ): Promise<MoveNodeResult | null> {
        
    }

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
        const tooltip = `${this.data.ids.type} | '${this.data.ids.display}'`;
        if (this.data.ids.description) {
            const md = new vscode.MarkdownString(`${tooltip}\n\n---\n\n${this.data.ids.description}`);
            md.supportHtml = true;
            md.supportThemeIcons = true;
            return md;
        }
        return tooltip;
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
