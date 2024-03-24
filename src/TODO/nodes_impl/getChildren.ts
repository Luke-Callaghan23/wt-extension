import { TreeNode } from "../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, RootNode, SnipNode, TODONode } from "../node";

export async function getChildren(
    this: TODONode,
    filter: boolean
): Promise<TreeNode[]> {

    const data = this.data;
    if (data.ids.type === 'chapter') {
        // Collect all text fragments of the chapter node as well as all snips
        const chapter = data as ChapterNode;

        // Filter out any fragments with no TODOs in them
        const fragments = [];
        for (const textNode of chapter.textData) {
            const todos = await textNode.getTODOCounts();
            if (!filter || todos > 0) {
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
        for (const textNode of snip.contents) {
            const todos = await textNode.getTODOCounts();
            if (!filter || todos > 0) {
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
            if (!filter || todos > 0) {
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