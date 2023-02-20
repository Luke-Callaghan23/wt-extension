/* eslint-disable curly */

import * as vscode from 'vscode';
import * as console from './../../../vsconsole';
import { OutlineTreeProvider, TreeNode } from '../outlineTreeProvider';
import * as fsNodes from '../fsNodes';
import { todo, isInvalidated, getTODO, Validated, TODO } from './TODOsView';
import * as extension from '../../../extension';
import { scanFragment } from './scanFragment';
import { convertToTODOData } from './convertFragmentNode';

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
    
    getTODOCounts (): number {

        if (this.data.ids.internal.startsWith('dummy')) {
            return 1;
        }

        const uri = this.getUri();
        if (!isInvalidated(uri)) {
            // If the TODO count for the uri is not invalidated, then use that count
            const thisTodo = getTODO(uri);
            if (thisTodo.type === 'count') {
                return thisTodo.data;
            }
            else if (thisTodo.type === 'todos') {
                return thisTodo.data.length;
            }
            else {
                throw new Error('Not possible');
            }
        }
        
        // Otherwise, if this node has been invalidated, then get the TODOs for this node
        // Depends on what kind of node this is
        switch (this.data.ids.type) {
            case 'root': {
                const root: RootNode = this.data as RootNode;
                const chaptersContainer: TODONode = root.chapters;
                const snipsContainer: TODONode = root.snips;

                // Get or re-calculate the TODO counts for both the chapters container and the 
                //      work snips container
                const chaptersTODOs = chaptersContainer.getTODOCounts();
                const snipsTODOs = snipsContainer.getTODOCounts();

                // Add the counts for each to get the new count of TODOs for the root
                const rootTODOs = chaptersTODOs + snipsTODOs;

                // Set the count for the root node in the todo tree and return the new count
                todo[uri] = {
                    type: 'count',
                    data: rootTODOs
                };
                return rootTODOs;
            }
            case 'container': {
                const container: ContainerNode = this.data as ContainerNode;
                const contents: TODONode[] = container.contents;

                // Get or re-calculate TODO counts for each of the items in this container's
                //      contents array, and sum them up
                const containerTODOs = contents.reduce((accumulatedTODOs, currentNode) => {
                    return accumulatedTODOs + currentNode.getTODOCounts();
                }, 0);

                // Set the count of TODOs for this container to the sum of the TODOs for all of
                //      its contents and return the new count
                todo[uri] = {
                    type: 'count',
                    data: containerTODOs
                };
                return containerTODOs;
            }
            case 'chapter': {
                const chapter: ChapterNode = this.data as ChapterNode;
                const snips: TODONode = chapter.snips;
                const fragements: TODONode[] = chapter.textData;

                // Calculate snip todos recursively 
                // Remember, .snips is a container node, so this function will handle
                //      processing of all snips using the 'container' case 
                const snipsTODOs = snips.getTODOCounts();

                // Get or re-calculate the TODO counts for each of the text fragments of
                //      this chapter, and sum them up
                const fragementsTODOs = fragements.reduce((accumulatedFragmentTODOs, currentFragment) => {
                    return accumulatedFragmentTODOs + currentFragment.getTODOCounts();
                }, 0);

                // Total TODO count for the chapter is the sum of all the TODOs in this chapter's text
                //      fragments as well as the TODOs for the chapter snips
                const chapterTODOs = snipsTODOs + fragementsTODOs;

                // Store the todo counts for the chapter, and return
                todo[uri] = {
                    type: 'count',
                    data: chapterTODOs
                };
                return chapterTODOs;
            }
            case 'snip': {
                const snip: SnipNode = this.data as SnipNode;
                const fragments: TODONode[] = snip.textData;

                // (see 'chapter', 'container' cases above)
                const fragmentsTODOs = fragments.reduce((accumulatedFragmentTODOs, currentFragment) => {
                    return accumulatedFragmentTODOs + currentFragment.getTODOCounts();
                }, 0);

                todo[uri] = {
                    type: 'count',
                    data: fragmentsTODOs
                };
                return fragmentsTODOs;
            }
            case 'fragment': {
                const fragmentNode: FragmentData = this.data as FragmentData;

                // Scan the text of the fragment for all TODOs
                const [ fragmentTODOs, count ]: [ Validated, number ] = scanFragment(uri, fragmentNode);

                // Insert the new fragment TODOs into todo object
                todo[uri] = fragmentTODOs;
                return count;
            }
            
        }
    }

    getChildren(): TreeNode[] {
        const data = this.data;
        if (data.ids.type === 'chapter') {
            // Collect all text fragments of the chapter node as well as all snips
            const chapter = data as ChapterNode;

            // Filter out any fragments with no TODOs in them
            const fragments = chapter.textData.filter((textNode) => textNode.getTODOCounts() > 0);
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

            // Add this chapter's snips container to the children array as well as long as the TODO
            //      count of the snips is non-zero
            const children: TreeNode[] = [ ...fragments ];
            if (chapter.snips.getTODOCounts() > 0) {
                children.push(chapter.snips);
            }

            return children;
        }
        else if (data.ids.type === 'snip') {
            // Collect all the text fragements of the snip
            const snip = data as SnipNode;

            // Filter out any fragments without any TODOs and sort them
            const fragments = snip.textData.filter((textNode) => textNode.getTODOCounts() > 0);
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            return fragments;
        }
        else if (data.ids.type === 'root') {
            // Collect all chapters and snips
            const root = data as RootNode;

            // Get the TODO counts in the chapters container and in the snips container
            const chapterCounts = root.chapters.getTODOCounts();
            const snipCounts = root.snips.getTODOCounts();

            // Return the chapter and root containers, as long as they have at least one
            //      marked TODO 
            const children: TreeNode[] = [];
            if (chapterCounts > 0) children.push(root.chapters);
            if (snipCounts > 0) children.push(root.snips);
            return children;
        }
        else if (data.ids.type === 'container') {
            // Collect all the children of this container
            const container = data as ContainerNode;
            
            // Filter out any of the content items that do not have any TODO items inside of them,
            //      and sort all TODOs
            const contents = container.contents.filter(content => content.getTODOCounts() > 0);
            contents.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

            // Return ordered contents
            return contents;
        }
        else if (data.ids.type === 'fragment') {
            if (data.ids.internal.startsWith('dummy')) {
                // If the internal id of the fragment is 'dummy' then it is actually a TODO node
                //      of a fragment (the specific fragment i is specified in the node's parent
                //      internal id)
                // A fragments's TODO nodes does not have any children
                return [];
            }
            
            // Collect all the TODO nodes of this fragment
            // Stored as TODONodes in a new array
            const todoNodes = this.convertToTODOData();
            // console.log(todoNodes);
            return todoNodes;
        }
        else {
            throw new Error(`Unexpected data type: '${data.ids.type}' in OutlineNode.getChildren`);
        }
    }

    hasChildren (): boolean {
        // Dummy nodes are the children of fragments, and are the only types of nodes that cannot have children in the TODO tree
        return !this.data.ids.internal.startsWith('dummy');
    }
    
    getTooltip (): string | vscode.MarkdownString {
        return `${this.data.ids.type} | TODOs: ${this.getTODOCounts()}`;
    }
    
    moveNode (newParent: TreeNode, provider: OutlineTreeProvider<TreeNode>): boolean {
        vscode.window.showErrorMessage('Error: cannot move files within the TODO tree, please try again in the outline tree');
        return false;
    }

    getUri (): string {
        return `${extension.rootPath}/${this.data.ids.relativePath}/${this.data.ids.fileName}`;
    }
    getDisplayString (): string {
        return this.data.ids.display;
    }
    
    getId (): string {
        return this.data.ids.internal;
    }

    getParentId(): string {
        return this.data.ids.parentInternalId;
    }

    data: NodeTypes;

    constructor(data: NodeTypes) {
        super();
        this.data = data;
    }
}
