import * as vscode from 'vscode';
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from "./outlineNode";
import * as console from "../../miscTools/vsconsole";
import { TreeNode } from "../../outlineProvider/outlineTreeProvider";

export async function getChildren (this: OutlineNode, filter: boolean, insertIntoNodeMap: (node: TreeNode, uri: vscode.Uri)=>void): Promise<OutlineNode[]> {
    const data = this.data;
    const ret: OutlineNode[] = (() => {
        if (data.ids.type === 'chapter') {
            // Collect all text fragments of the chapter node as well as all snips
            const chapter = data as ChapterNode;
    
            // Collect and order all the fragment data
            const fragments = chapter.textData.map(td => td as unknown as OutlineNode);
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            
            // Return ordered fragments as well as snips container
            return [ ...fragments, chapter.snips ];
        }
        else if (data.ids.type === 'snip') {
            // Collect all the text fragements of the snip
            const snip = data as SnipNode;
            const fragments = [ ...snip.contents ];
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            return fragments;
        }
        else if (data.ids.type === 'root') {
            // Collect all chapters and snips
            const root = data as RootNode;
            
            // Simply return both of the container nodes for the root type
            return [ root.chapters, root.snips ];
        }
        else if (data.ids.type === 'container') {
            // Collect all the children of this container
            const container = data as ContainerNode;
            
            // Order the contents
            const contents = container.contents.map(td => td as unknown as OutlineNode);
            contents.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
    
            // Return ordered contents
            return contents;
        }
        else if (data.ids.type === 'fragment') {
            return [];
        }
        else {
            throw new Error(`Unexpected data type: '${data.ids.type}' in OutlineNode.getChildren`);
        }
    })();
    for (const n of ret) {
        insertIntoNodeMap(n, n.getUri());
    }
    return ret;
}