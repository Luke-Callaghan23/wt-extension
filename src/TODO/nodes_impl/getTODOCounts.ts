import * as vscode from 'vscode'
import { ChapterNode, ContainerNode, FragmentNode, RootNode, SnipNode, TODONode } from "../node";
import { TODOsView, Validation } from "../TODOsView";
import { scanFragment } from "../impl/scanFragment";
import { ExtensionGlobals } from '../../extension';
import { getFsPathKey, setFsPathKey } from '../../help';

export async function getTODOCounts (
    this: TODONode
): Promise<number> {

    // A TODO entry (the child of a fragment in the TODO view) is identified by having 
    //      a type id of 'fragment' and a parent type id also of 'fragment'
    // These nodes represent a single identified TODO in a text document, so it has a 
    //      count of 1 TODO
    if (this.data.ids.parentTypeId === 'fragment' && this.data.ids.type === 'fragment') {
        return 1;
    }

    const todosView: TODOsView = ExtensionGlobals.todoView;

    const uri = this.getUri();
    if (!todosView.isInvalidated(uri)) {
        // If the TODO count for the uri is validated, then use the validated TODO 
        //      count of this node
        const thisTodo = getFsPathKey<Validation>(uri, TODOsView.todo)!;
        
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
    
    console.log(`${uri.fsPath} . . . `);
    
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
            // const [ chaptersTODOs, snipsTODOs ] = await Promise.all([
            //     chaptersContainer.getTODOCounts(),
            //     snipsContainer.getTODOCounts()
            // ]);

            const chaptersTODOs = await chaptersContainer.getTODOCounts()
            const snipsTODOs = await snipsContainer.getTODOCounts()

            // Add the counts for each to get the new count of TODOs for the root
            const rootTODOs = chaptersTODOs + snipsTODOs;

            // Set the count for the root node in the todo tree and return the new count
            setFsPathKey<Validation>(uri, {
                type: 'count',
                data: rootTODOs
            }, TODOsView.todo);
            return rootTODOs;
        }
        case 'container': {
            const container: ContainerNode = this.data as ContainerNode;
            const contents: TODONode[] = container.contents;

            // Get or re-calculate TODO counts for each of the items in this container's
            //      contents array, and sum them up
            const containerTODOsLst: number[] = [];
            for (const currentNode of contents) {
                const counts = await currentNode.getTODOCounts();
                containerTODOsLst.push(counts)
            }

            let containerTODOs = 0;
            for (let n = 0; n < containerTODOsLst.length; n++) {
                containerTODOs+=containerTODOsLst[n];
            }

            // Set the count of TODOs for this container to the sum of the TODOs for all of
            //      its contents and return the new count
            setFsPathKey<Validation>(uri, {
                type: 'count',
                data: containerTODOs
            }, TODOsView.todo);
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
            setFsPathKey<Validation>(uri, {
                type: 'count',
                data: chapterTODOs
            }, TODOsView.todo);
            return chapterTODOs;
        }
        case 'snip': {
            const snip: SnipNode = this.data as SnipNode;
            const ctent: TODONode[] = snip.contents;
            
            // (see 'chapter', 'container' cases above)
            const containerTODOsLst: number[] = [];
            try {
                for (const currentNode of ctent) {
                    const counts = await currentNode.getTODOCounts();
                    containerTODOsLst.push(counts)
                }
            }
            catch (err) {
                console.log(err);
            }

            let snipsTODOs = 0;
            for (let n = 0; n < containerTODOsLst.length; n++) {
                snipsTODOs+=containerTODOsLst[n];
            }

            setFsPathKey<Validation>(uri, {
                type: 'count',
                data: snipsTODOs
            }, TODOsView.todo);
            return snipsTODOs;
        }
        case 'fragment': {
            const fragmentNode: FragmentNode = this.data as FragmentNode;

            // To get the TODO counts of a fragment, we need to stop recursing into this function
            //      and actually read some text
            // Use scanFragments to get a list of all the TODO entries in the selected fragment (`this`)
            //      and the total count of all todos
            const [ fragmentTODOs, count ]: [ Validation, number ] = await scanFragment(uri, fragmentNode);

            // Insert the new fragment TODOs into todo object
            setFsPathKey<Validation>(uri, fragmentTODOs, TODOsView.todo);
            return count;
        }
    }
}