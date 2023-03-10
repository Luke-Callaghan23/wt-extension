/* eslint-disable curly */

import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { OutlineTreeProvider, TreeNode } from '../outlineProvider/outlineTreeProvider';
import * as fsNodes from '../outlineProvider/fsNodes';
import { todo, isInvalidated, getTODO, Validated, TODO } from './TODOsView';
import * as extension from '../extension';
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
    
    async getTODOCounts (): Promise<number> {

        if (this.data.ids.internal.startsWith('dummy')) {
            return 1;
        }

        const uri = this.getUri();
        if (!isInvalidated(uri.fsPath)) {
            // If the TODO count for the uri is not invalidated, then use that count
            const thisTodo = getTODO(uri.fsPath);
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
                const chaptersTODOs = await chaptersContainer.getTODOCounts();
                const snipsTODOs = await snipsContainer.getTODOCounts();

                // Add the counts for each to get the new count of TODOs for the root
                const rootTODOs = chaptersTODOs + snipsTODOs;

                // Set the count for the root node in the todo tree and return the new count
                todo[uri.fsPath] = {
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
                let containerTODOs = 0;
                for (const currentNode of contents) {
                    containerTODOs += await currentNode.getTODOCounts();
                }

                // Set the count of TODOs for this container to the sum of the TODOs for all of
                //      its contents and return the new count
                todo[uri.fsPath] = {
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
                const snipsTODOs = await snips.getTODOCounts();

                // Get or re-calculate the TODO counts for each of the text fragments of
                //      this chapter, and sum them up
                let fragementsTODOs = 0;
                for (const currentFragment of fragements) {
                    fragementsTODOs += await currentFragment.getTODOCounts();
                }

                // Total TODO count for the chapter is the sum of all the TODOs in this chapter's text
                //      fragments as well as the TODOs for the chapter snips
                const chapterTODOs = snipsTODOs + fragementsTODOs;

                // Store the todo counts for the chapter, and return
                todo[uri.fsPath] = {
                    type: 'count',
                    data: chapterTODOs
                };
                return chapterTODOs;
            }
            case 'snip': {
                const snip: SnipNode = this.data as SnipNode;
                const fragments: TODONode[] = snip.textData;

                // (see 'chapter', 'container' cases above)
                let fragmentsTODOs = 0;
                for (const currentFragment of fragments) {
                    fragmentsTODOs += await currentFragment.getTODOCounts();
                }

                todo[uri.fsPath] = {
                    type: 'count',
                    data: fragmentsTODOs
                };
                return fragmentsTODOs;
            }
            case 'fragment': {
                const fragmentNode: FragmentData = this.data as FragmentData;

                // Scan the text of the fragment for all TODOs
                const [ fragmentTODOs, count ]: [ Validated, number ] = await scanFragment(uri, fragmentNode);

                // Insert the new fragment TODOs into todo object
                todo[uri.fsPath] = fragmentTODOs;
                return count;
            }
            
        }
    }

    async getChildren(): Promise<TreeNode[]> {
        const data = this.data;
        if (data.ids.type === 'chapter') {
            // Collect all text fragments of the chapter node as well as all snips
            const chapter = data as ChapterNode;

            // Filter out any fragments with no TODOs in them
            const fragments = [];
            for (const textNode of chapter.textData) {
                const todos = await textNode.getTODOCounts();
                if (todos > 0) {
                    fragments.push(textNode);
                }
            }
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

            // Add this chapter's snips container to the children array as well as long as the TODO
            //      count of the snips is non-zero
            const children: TreeNode[] = [ ...fragments ];
            if (await chapter.snips.getTODOCounts() > 0) {
                children.push(chapter.snips);
            }

            return children;
        }
        else if (data.ids.type === 'snip') {
            // Collect all the text fragements of the snip
            const snip = data as SnipNode;

            // Filter out any fragments without any TODOs and sort them
            const fragments = []
            for (const textNode of snip.textData) {
                const todos = await textNode.getTODOCounts();
                if (todos > 0) {
                    fragments.push(textNode);
                }
            }
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            return fragments;
        }
        else if (data.ids.type === 'root') {
            // Collect all chapters and snips
            const root = data as RootNode;

            // Get the TODO counts in the chapters container and in the snips container
            const chapterCounts = await root.chapters.getTODOCounts();
            const snipCounts = await root.snips.getTODOCounts();

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
            const contents = [];
            for (const content of container.contents){
                const todos = await content.getTODOCounts();
                if (todos > 0) {
                    contents.push(content);
                }
            } 
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
    
    async moveNode (newParent: TreeNode, provider: OutlineTreeProvider<TreeNode>): Promise<number> {
        vscode.window.showErrorMessage('Error: cannot move files within the TODO tree, please try again in the outline tree');
        return -1;
    }

    getUri (): vscode.Uri {
        return vscode.Uri.joinPath(extension.rootPath, this.data.ids.relativePath, this.data.ids.fileName);
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
