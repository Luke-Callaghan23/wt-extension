/* eslint-disable curly */

import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../vsconsole';
import { OutlineTreeProvider, TreeNode } from '../outlineProvider/outlineTreeProvider';
import * as fsNodes from '../outlineProvider/fsNodes';
import { todo, isInvalidated, getTODO, Validation, TODO, TODOsView } from './TODOsView';
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
        // A TODO entry (the child of a fragment in the TODO view) is identified by having 
        //      a type id of 'fragment' and a parent type id also of 'fragment'
        // These nodes represent a single identified TODO in a text document, so it has a 
        //      count of 1 TODO
        if (this.data.ids.parentTypeId === 'fragment' && this.data.ids.type === 'fragment') {
            return 1;
        }

        const uri = this.getUri();
        if (!isInvalidated(uri.fsPath)) {
            // If the TODO count for the uri is validated, then use the validated TODO 
            //      count of this node
            const thisTodo = todo[uri];
            
            if (thisTodo.type === 'count') {
                // type == count -> a 'folder' of todos, .data is a sum of all the todo counts of all the children
                return thisTodo.data;
            }
            else if (thisTodo.type === 'todos') {
                // type == todos -> this is a fragment, .data is an array of all the TODO entries inside of this
                //      fragment
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

                // If calculating TODOs for the root node, simply recurse into this function for each of
                //      the chapters container and the work snips container
                // Use Promise.all to concurrently perform both of these actions as they do not depend on each other
                //      I don't know if it actually speeds up in a vscode environment but oh well :)
                const [ chaptersTODOs, snipsTODOs ] = await Promise.all([
                    chaptersContainer.getTODOCounts(),
                    snipsContainer.getTODOCounts()
                ]);

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
                const containerTODOs = (await Promise.all(
                    contents.map(currentNode => currentNode.getTODOCounts())
                )).reduce(((acc, cur) => acc + cur), 0);

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
                const fragments: TODONode[] = chapter.textData;

                // Total TODO count for the chapter is the sum of all the TODOs in this chapter's text
                //      fragments as well as the TODOs for the chapter snips
                const chapterTODOs = (await Promise.all([
                    
                    // SNIPS:
                    // Calculate snip todos recursively 
                    // Remember, .snips is a container node, so this function will handle
                    //      processing of all snips using the 'container' case showcased above
                    //      (which will then recurse into each of the snips)
                    snips.getTODOCounts(),

                    // FRAGMENTS:
                    // Get or re-calculate the TODO counts for each of the text fragments of
                    //      this chapter
                    ...fragments.map(currentFragment => currentFragment.getTODOCounts())
                ])).reduce(((acc, cur) => acc + cur), 0);

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
                const fragmentsTODOs = (await Promise.all(
                    fragments.map(currentFragment => currentFragment.getTODOCounts())
                )).reduce(((acc, cur) => acc + cur), 0);

                todo[uri.fsPath] = {
                    type: 'count',
                    data: fragmentsTODOs
                };
                return fragmentsTODOs;
            }
            case 'fragment': {
                const fragmentNode: FragmentData = this.data as FragmentData;

                // To get the TODO counts of a fragment, we need to stop recursing into this function
                //      and actually read some text
                // Use scanFragments to get a list of all the TODO entries in the selected fragment (`this`)
                //      and the total count of all todos
                const [ fragmentTODOs, count ]: [ Validation, number ] = await scanFragment(uri, fragmentNode);

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
            // Sort the fragments of this chapter by their ordering
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

            // 
            const children: TreeNode[] = [ ...fragments ];

            // Add this chapter's snips container to the children array as well as long as the TODO
            //      count of the snips is non-zero
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
            if (data.ids.parentTypeId === 'fragment') {
                // The only situation where a parent type of a fragment node is also a fragment node
                //      is when the child is a TODO fragment -- as in, a leaf node which describes the 
                //      location in a fragment of a TODO node
                // A fragments's TODO nodes does not have any children
                return [];
            }
            
            // Collect all the TODO nodes of this fragment
            // Stored as TODONodes in a new array
            const todoNodes = this.convertToTODOData();
            return todoNodes;
        }
        else {
            throw new Error(`Unexpected data type: '${data.ids.type}' in OutlineNode.getChildren`);
        }
    }

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
