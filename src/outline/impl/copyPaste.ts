import * as vscode from 'vscode';
import { ChapterNode, ContainerNode, FragmentNode, OutlineNode, RootNode, SnipNode } from '../node';
import { OutlineView } from '../outlineView';
import { FileAccessManager } from '../../fileAccesses';
import * as vscodeUris from 'vscode-uri';
import { getUsableFileName } from './createNodes';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../../help';

export type CopiedSelection = {
    count: number;
    nodes: OutlineNode[],
    type: 'fragment' | 'snip' | 'chapter' | 'chapterSnipsContainer' | 'workSnipsContainer' | 'chaptersContainer'
};

export async function copy (
    this: OutlineView,
    selected: readonly OutlineNode[]
): Promise<void> {
    // Filter to only the most relevant copied nodes
    // Keep only the nodes at the highest "level"
    //      Ex: if a snip and a fragment are selected, then only copy the snip
    //      Ex: if a chapter and a snip are selected, then only copy the chapter
    //      Ex: if the chapter container and X are selected, then only copy the chapter container
    //      Ex: if the work snips container and X are selected then copy only the work snips container,
    //          as long as X is not the chapter container
    //      Ex: if a chapter's snips container and X is selected, then copy only the chapter snips container
    //          as long as X is not the chapter container or the work snips container
    //      But: if root and X are selected, keep only X, whatever X is
    // Keep all items at the highest "level"
    
    // First, sort all the items in the selected array into their corresponding buckets
    const sortedSelections: {
        chapters: OutlineNode[],
        snips: OutlineNode[],
        fragments: OutlineNode[],
        chaptersContainer: OutlineNode[],
        workSnipsContainer: OutlineNode[],
        chapterSnipsContainer: OutlineNode[],
    } = {
        chapters: [],
        snips: [],
        fragments: [],
        chaptersContainer: [],
        workSnipsContainer: [],
        chapterSnipsContainer: [],
    };

    selected.forEach(node => {
        switch (node.data.ids.type) {
            case 'chapter':
                sortedSelections.chapters.push(node);
                break;
            case 'snip':
                sortedSelections.snips.push(node);
                break;
            case 'fragment':
                sortedSelections.fragments.push(node);
                break;
            case 'container': 
                // Need to check what kind of content this container holds before pushing the node
                //      into one of the above buckets

                // The chapters container and work snips container are the only nodes
                //      in the outline tree whose parent types are `'root'`
                if (node.data.ids.parentTypeId === 'root') {
                    // Work snips and chapters containers can be differentiated by the type id
                    //      of their first child
                    const children = (node.data as ContainerNode).contents;

                    // If the container does not have any children, then there's nothing to copy anyways,
                    //      so just skip
                    if (children.length === 0) return;

                    // If the first child of the container is a chapter, then this container is the chapters
                    //      container, and it is the work snips container otherwise
                    const firstChild = children[0];
                    if (firstChild.data.ids.type === 'snip') {
                        sortedSelections.workSnipsContainer.push(node);
                    }
                    else if (firstChild.data.ids.type === 'chapter') {
                        sortedSelections.chaptersContainer.push(node);
                    }
                    else throw 'Not reachable';
                }
                // The only other kind of container that exists are chapter snips containers
                //      these have parent type ids of `'chapter'`
                else if (node.data.ids.parentTypeId === 'chapter') {
                    sortedSelections.chapterSnipsContainer.push(node);
                }
                else throw 'Not reachable';
                break;
            // Never copy the root element
            case 'root': break;
        }
    });

    let copiedSelection: CopiedSelection;
    
    // Create a selection object for the nodes with the highest relvance
    // And retain the names of the copied nodes
    if (sortedSelections.chaptersContainer.length !== 0) {
        const copied = sortedSelections.chaptersContainer;
        copiedSelection = {
            count: copied.length,
            nodes: copied,
            type: 'chapterSnipsContainer',
        };
    }
    else if (sortedSelections.workSnipsContainer.length !== 0) {
        const copied = sortedSelections.workSnipsContainer;
        copiedSelection = {
            count: copied.length,
            nodes: copied,
            type: 'workSnipsContainer',
        };
    }
    else if (sortedSelections.chapterSnipsContainer.length !== 0) {
        const copied = sortedSelections.chapterSnipsContainer;
        copiedSelection = {
            count: copied.length,
            nodes: copied,
            type: 'chapterSnipsContainer',
        };
    }
    else if (sortedSelections.chapters.length !== 0) {
        const copied = sortedSelections.chapters;
        copiedSelection = {
            count: copied.length,
            nodes: copied,
            type: 'chapter',
        };
    }
    else if (sortedSelections.snips.length !== 0) {
        const copied = sortedSelections.snips;
        copiedSelection = {
            count: copied.length,
            nodes: copied,
            type: 'snip',
        };
    }
    else if (sortedSelections.fragments.length !== 0) {
        const copied = sortedSelections.fragments;
        copiedSelection = {
            count: copied.length,
            nodes: copied,
            type: 'fragment',
        };
    }
    else throw 'Not reachable';

    // Send message with names of copied resources to user
    const copiedNames = copiedSelection.nodes.map(node => node.data.ids.display);
    const copiedNamesStr = copiedNames.join("', '");
    const copiedCount = copiedNames.length;
    const message = `Successfully copied (${copiedCount}) resources: '${copiedNamesStr}'`;
    vscode.window.showInformationMessage(message);

    // Emit a warning if there was any amount of ignored content
    if (selected.length !== copiedSelection.count) {
        const ignoredCount = selected.length - copiedSelection.count;
        vscode.window.showWarningMessage(`Ignored (${ignoredCount}) items in copy`);
    }

    // Store references to the copied contents in workspace state
    return this.context.workspaceState.update('copied', copiedSelection);
}


// Paste a validated selection of content into a single destination
// If there exists more than one destination, the handler for command
//      `'wt.outline.pasteItems'` will paste into all destinations
//      sequentially
export async function paste (
    this: OutlineView,
    destination: OutlineNode,
    copied: CopiedSelection,
    pasteLog: { [index: string]: 1 },            // A log of all the locations that have been pasted into in the current paste
    nameModifier: string = 'copy'                // string to be inserted in parentheses after the name of the pasted item (default is `OLD NAME (copy)`)
): Promise<vscode.Uri | null> {

    type Paste = {
        pastables: OutlineNode[],
        destination: OutlineNode,
        pasteType: 'snip' | 'fragment' | 'chapter'
    }

    // Depending on the type of copied content and type of paste destination,
    //      find the container to copy content into
    const getContainerAndPastables = async (): Promise<Paste> => {
        let pastables: OutlineNode[] | undefined;

        switch (copied.type) {
            case 'chapter': 
                pastables = copied.nodes;
            case 'chaptersContainer': {
                // In all cases where the copied content is the chapter container or a chapter node,
                //      then the destination container should be the chapter container
                return {
                    destination: (this.tree.data as RootNode).chapters,
                    pastables: pastables || (copied.nodes[0].data as ContainerNode).contents,
                    pasteType: 'chapter'
                };
            }
            case 'snip':
                pastables = copied.nodes;
            case 'chapterSnipsContainer': case 'workSnipsContainer': {
                const fallback = (this.tree.data as RootNode).snips;
                
                // Get "final" pastables -- a collection of all paste items
                // If there are already pastables (if the copy type is snip(s)), use that
                // Otherwise (if the copy target is a snip container), loop through all 
                //      the snip containers in `copied.nodes`, and use all snips
                const finalPastables = pastables || copied.nodes.map(node => {
                    return (node.data as ContainerNode).contents;
                }).flat();


                switch (destination.data.ids.type) {
                    case 'root': 
                        // Pasting snip or snip container into root -> use the work snips container
                        return {
                            destination: fallback,
                            pastables: finalPastables,
                            pasteType: 'snip'
                        };
                    case 'snip': 
                        // Pasting into a snip
                        const destinationSnipParentUri = destination.data.ids.parentUri;
                        const destinationSnipParent: OutlineNode | undefined | null = await this._getTreeElementByUri(destinationSnipParentUri);
                        if (!destinationSnipParent) {
                            // If we can't find the parent container in the outline view, default to the 
                            //      work snips container
                            return {
                                destination: fallback,
                                pastables: finalPastables,
                                pasteType: 'snip'
                            };
                        }
                        return {
                            destination: destinationSnipParent,
                            pastables: finalPastables,
                            pasteType: 'snip'
                        };
                    case 'container': 
                        // Determine the container type:
                        //      can be the work snips container, the chapters container, or a chapter snips container
                        if (destination.data.ids.parentTypeId === 'root') {
                            // CASE: container is either the chapters container or the work snips container
                            // Determine which container kind based on the file name of the container
                            if (destination.data.ids.fileName === 'chapters') {

                                // Find the fallback for the chapter container
                                // Fallback is either the snips container of the first chapter in the chapters container, or (if there are no chapters)
                                //      then use the original fallback, the work snips container
                                let fallbackChapter: OutlineNode;
                                const chaptersContainer = (this.tree.data as RootNode).chapters.data as ContainerNode;
                                if (chaptersContainer.contents.length === 0) {
                                    fallbackChapter = fallback;
                                }
                                else {
                                    const firstChapter = chaptersContainer.contents[0].data as ChapterNode;
                                    fallbackChapter = firstChapter.snips;
                                }

                                const lastChapterUri = FileAccessManager.lastAccessedChapter;
                                if (!lastChapterUri) {
                                    // If there is no last accessed chapter, then try using the first chapter in the chapters container
                                    return {
                                        destination: fallbackChapter,
                                        pastables: finalPastables,
                                        pasteType: 'snip'
                                    };
                                }
                                const lastChapter: OutlineNode | undefined | null = await this._getTreeElementByUri(lastChapterUri);
                                if (!lastChapter) {
                                    return {
                                        destination: fallbackChapter,
                                        pastables: finalPastables,
                                        pasteType: 'snip'
                                    };
                                }

                                // If the chapter does exist, then use the snip container inside of that chapter
                                return {
                                    destination: (lastChapter.data as ChapterNode).snips,
                                    pastables: finalPastables,
                                    pasteType: 'snip'
                                };
                            }
                            else if (destination.data.ids.fileName === 'snips') {
                                // If the destination is the work snips container, use that container
                                //      as the parent
                                return {
                                    destination: destination,
                                    pastables: finalPastables,
                                    pasteType: 'snip'
                                };
                            }
                            else throw 'Not reachable';
                        }
                        else {
                            // CASE: container is a chapter snips container, simply use the destination itself
                            return {
                                destination: destination,
                                pastables: finalPastables,
                                pasteType: 'snip'
                            };
                        }
                    case 'chapter': 
                        // If the destination for the pasted snips is a chapter, then use that chapter's snips container
                        return {
                            destination: (destination.data as ChapterNode).snips,
                            pastables: finalPastables,
                            pasteType: 'snip'
                        };
                    case 'fragment': {
                        const fragmentContainerUri  = destination.data.ids.parentUri;
                        const fragmentContainer: OutlineNode | undefined | null = await this._getTreeElementByUri(fragmentContainerUri);
                        if (!fragmentContainer) {
                            return {
                                destination: fallback,
                                pastables: finalPastables,
                                pasteType: 'snip'
                            };
                        }

                        if (fragmentContainer.data.ids.type === 'chapter') {
                            // If the parent of the fragment is a snip, then use the snips container of
                            //      that chapter as parent
                            return {
                                destination: (fragmentContainer.data as ChapterNode).snips,
                                pastables: finalPastables,
                                pasteType: 'snip'
                            };
                        }
                        else if (fragmentContainer.data.ids.type === 'snip') {
                            // If the parent is another snip, then use the container of that snip
                            const snipContainerUri = fragmentContainer.data.ids.parentUri;
                            const snipContainer: OutlineNode | undefined | null = await this._getTreeElementByUri(snipContainerUri);
                            if (!snipContainer) {
                                return {
                                    destination: fallback,
                                    pastables: finalPastables,
                                    pasteType: 'snip'
                                };
                            }
                            return {
                                destination: snipContainer,
                                pastables: finalPastables,
                                pasteType: 'snip'
                            };
                        }
                        else throw 'Not reachable';
                    }
                }
            }
            case 'fragment': {
                // The fallback for the fallback fragment container should be the parent of the first copied fragmnet
                //      this is worst case scenario and should really never happen -- hopefully
                const fallbackFallbackUri = copied.nodes[0].data.ids.parentUri;
                const fallbackFallback: OutlineNode | undefined | null = await this._getTreeElementByUri(fallbackFallbackUri);
                if (!fallbackFallback) {
                    throw 'Paste destination must have a parent -- this really, really shouldn\'t happen';
                }

                // Gets the container of a fragment by uri -- fragment container is always a chapter or a snip
                const getContainerForFragment = async (uri: vscode.Uri | undefined): Promise<OutlineNode | null> => {
                    if (!uri) return null;
                    const fragmentNode: OutlineNode | undefined | null = await this._getTreeElementByUri(uri);
                    if (!fragmentNode || fragmentNode.data.ids.type !== 'fragment') return null;
                    const fragmentContainerUri = fragmentNode.data.ids.parentUri;
                    const fragmentContainer: OutlineNode | undefined | null = await this._getTreeElementByUri(fragmentContainerUri);
                    if (!fragmentContainer) return null;
                    return fragmentContainer.data.ids.type === 'chapter' || fragmentContainer.data.ids.type === 'snip'
                        ? fragmentContainer : null;
                };

                // Gets a fragment container (a chapter or snip node) from its uri
                const getFragmentContainer = async (uri: vscode.Uri | undefined): Promise<OutlineNode | null> => {
                    if (!uri) return null;
                    const node: OutlineNode | undefined | null = await this._getTreeElementByUri(uri);
                    if (!node) return null;
                    return node.data.ids.type === 'chapter' || node.data.ids.type === 'snip'
                        ? node : null;
                };

                // Find the fallback container for the copied fragments:
                const fallback: OutlineNode = await getContainerForFragment(FileAccessManager.lastAccessedFragment)        // First fallback is the container of the last accessed fragment
                    || await getFragmentContainer(FileAccessManager.lastAccessedSnip)                                       // Next fallback is the last accessed snip
                    || await getFragmentContainer(FileAccessManager.lastAccessedChapter)                                    // Next fallback is the last accessed chapter
                    || fallbackFallback;                                                                                            // Last fallback is the container of the first copied fragment

                switch (destination.data.ids.type) {
                    case 'root': 
                        // If the destination is the root, the just use the fallback container as the parent container
                        return {
                            pastables: copied.nodes,
                            destination: fallback,
                            pasteType: 'fragment'
                        };
                    case 'container': 
                        // If the destination is a container, then use the file access manager to find the latest
                        //      accessed fragment in that container
                        // Use the latest accessed fragment's container
                        const containerLatestFragmentUri = FileAccessManager.lastAccessedFragmentForUri(destination.data.ids.uri);
                        return {
                            pastables: copied.nodes,
                            destination: await getContainerForFragment(containerLatestFragmentUri) || fallback,
                            pasteType: 'fragment'
                        };
                    case 'fragment': 
                        // If the destination is another fragment, then find the parent of that fragment and use that
                        return {
                            pastables: copied.nodes,
                            destination: await getFragmentContainer(destination.data.ids.uri) || fallback,
                            pasteType: 'fragment'
                        };
                    case 'chapter': case 'snip': 
                        // If the destination is a snip or a chapter, then we can easily use that as the destination for the copied
                        //      snip
                        return {
                            pastables: copied.nodes,
                            destination: destination,
                            pasteType: 'fragment'
                        };
                }
            }
        }
    }


    type PasteResult = {
        fileName: string,
        config: ConfigFileInfo,
        fragmentUris: vscode.Uri[]
    }

    //#region paste functions
    const pasteFragment = async (
        src: OutlineNode,               // Should ALWAYS be a `fragment` node
        dest: OutlineNode,              // Should ALWAYS be a `chapter` or `snip` node
        ordering: number
    ): Promise<PasteResult> => {
        
        if (src.data.ids.type !== 'fragment') {
            throw `Not reachable`;
        }
        if (dest.data.ids.type !== 'chapter' && dest.data.ids.type !== 'snip') {
            throw `Not reachable`;
        }

        const awaitables: (Promise<any> | Thenable<any>)[] = [];

        // Want to use a new file name for the copied content because of the case where a user may want to copy and paste 
        //      a fragment in the same location as the original
        const newFileName = getUsableFileName('fragment', true);
        const destinationContainerUri = dest.data.ids.uri;
        const destinationFullUri = vscodeUris.Utils.joinPath(destinationContainerUri, newFileName);
        
        // Do the copy operation after reading .config from disk
        const copyPromise = vscode.workspace.fs.copy(src.data.ids.uri, destinationFullUri);
        awaitables.push(copyPromise);

        const copiedDisplay = `${src.data.ids.display} (${nameModifier})`;
        const fragmentConfig = {
            ordering: ordering,
            title: copiedDisplay
        };

        // The internal array of fragment content for the destination
        const destContent = (dest.data as ChapterNode | SnipNode).textData;
        
        // Create a new object for the copied fragment
        const newFragmentData: FragmentNode = {
            ids: {
                display: `${src.data.ids.display} (${nameModifier})`,
                fileName: newFileName,
                relativePath: `${dest.data.ids.relativePath}/${dest.data.ids.fileName}`,
                ordering: ordering,
                parentTypeId: dest.data.ids.type,
                parentUri: dest.data.ids.uri,
                type: 'fragment',
                uri: destinationFullUri
            },
            md: ''
        };
        const newFragmentNode = new OutlineNode(newFragmentData);
        destContent.push(newFragmentNode);

        await Promise.all(awaitables);
        return {
            fileName: newFileName, 
            config: fragmentConfig,
            fragmentUris: [destinationFullUri],
        };
    };

    const pasteSnip = async (
        src: OutlineNode,               // Should ALWAYS be a `snip` node
        dest: OutlineNode,              // Should ALWAYS be a `container` node
        ordering: number,
    ): Promise<PasteResult> => {
        
        if (src.data.ids.type !== 'snip') {
            throw `Not reachable`;
        }
        if (dest.data.ids.type !== 'container') {
            throw `Not reachable`;
        }

        const awaitables: (Promise<any> | Thenable<any>)[] = [];

        // Create the folder which will contain the contents of the copied snip
        const newFileName = getUsableFileName('snip');
        const destinationContainerUri = dest.data.ids.uri;
        const destinationFullUri = vscodeUris.Utils.joinPath(destinationContainerUri, newFileName);
        await vscode.workspace.fs.createDirectory(destinationFullUri);
        
        // Create the configuration item for this new snip
        const copiedDisplay = `${src.data.ids.display} (${nameModifier})`;
        const snipConfig = {
            ordering: ordering,
            title: copiedDisplay
        };

        // Content array of the destination container where the new snip will be stored
        const destContent = (dest.data as ContainerNode).contents;

        // Create and store the new snip
        const copiedSnipData: SnipNode = {
            ids: {
                display: copiedDisplay,
                fileName: newFileName,
                ordering: ordering,
                parentTypeId: 'container',
                parentUri: dest.data.ids.uri,
                relativePath: `${dest.data.ids.relativePath}/${dest.data.ids.fileName}`,
                type: 'snip',
                uri: destinationFullUri
            },
            textData: []
        };
        const copiedSnipNode = new OutlineNode(copiedSnipData);
        destContent.push(copiedSnipNode);

        // Asynchronously copy all the fragments inside of the source snip into the (newly created) destination
        //      snip
        const srcFragments = (src.data as SnipNode).textData;
        const fragmentsConfigInfo = await Promise.all(srcFragments.map(fragment => {
            const fragmentOrdering = fragment.data.ids.ordering;
            return pasteFragment(fragment, copiedSnipNode, fragmentOrdering);
        }));

        const allFragmentUris: vscode.Uri[] = [];

        // Copy config info for all the new fragments into fragment config for the newly copied snip
        const snipFragmentConfig: { [index: string]: ConfigFileInfo } = {};
        for (const { fileName, config, fragmentUris: [ uri ] } of fragmentsConfigInfo) {
            snipFragmentConfig[fileName] = config;
            allFragmentUris.push(uri);
        }

        // Write the .config for snip fragments to disk
        const snipsFragmentsDotConfigUri = vscodeUris.Utils.joinPath(destinationFullUri, '.config');
        const writeSnipFragmentsDotConfig = writeDotConfig(snipsFragmentsDotConfigUri, snipFragmentConfig);
        awaitables.push(writeSnipFragmentsDotConfig);

        await Promise.all(awaitables);
        return {
            fileName: newFileName, 
            config: snipConfig,
            fragmentUris: allFragmentUris
        };
    };

    const pasteChapter = async (
        src: OutlineNode,               // Should ALWAYS be a `chapter` node
        dest: OutlineNode,              // Should ALWAYS be a `container` node -- the container node found at `this.tree.chapters`
        ordering: number
    ): Promise<PasteResult> => {
        
        if (src.data.ids.type !== 'chapter') {
            throw `Not reachable`;
        }
        if (dest.data.ids.type !== 'container') {
            throw `Not reachable`;
        }

        const awaitables: (Promise<any> | Thenable<any>)[] = [];

        // Create the folder which will contain the contents of the copied chapter
        const newFileName = getUsableFileName('chapter');
        const destinationContainerUri = dest.data.ids.uri;
        const copiedChapterFullUri = vscodeUris.Utils.joinPath(destinationContainerUri, newFileName);
        await vscode.workspace.fs.createDirectory(copiedChapterFullUri);

        // Create the inner snips container which will hold all the copied chapters'
        //      snips content
        const copiedChapterSnipsContainerUri = vscodeUris.Utils.joinPath(copiedChapterFullUri, 'snips');
        await vscode.workspace.fs.createDirectory(copiedChapterSnipsContainerUri);
        
        // Create the configuration item for this new chapter
        const copiedDisplay = `${src.data.ids.display} (${nameModifier})`;
        const chapterConfig = {
            ordering: ordering,
            title: copiedDisplay
        };

        // Content array of the destination container where the new snip will be stored
        const destContent = (dest.data as ContainerNode).contents;

        // First create the container node which represents the snip container for this copied chapter
        const chapterRelativePath = `${dest.data.ids.relativePath}/${dest.data.ids.fileName}`;
        const copiedChapterSnipContainerData: ContainerNode = {
            ids: {
                display: 'snips',
                fileName: 'snips',
                ordering: 1000000,
                parentTypeId: 'chapter',
                parentUri: copiedChapterFullUri,
                relativePath: `${chapterRelativePath}/${newFileName}`,
                type: 'container',
                uri: copiedChapterSnipsContainerUri
            },
            contents: []
        };
        const copiedChapterSnipsContainerNode = new OutlineNode(copiedChapterSnipContainerData);

        const copiedChapterData: ChapterNode = {
            ids: {
                display: copiedDisplay,
                fileName: newFileName,
                ordering: ordering,
                parentTypeId: 'container',
                parentUri: dest.data.ids.uri,
                relativePath: chapterRelativePath,
                type: 'chapter',
                uri: copiedChapterFullUri
            },
            snips: copiedChapterSnipsContainerNode,
            textData: []
        };
        const copiedSnipNode = new OutlineNode(copiedChapterData);
        destContent.push(copiedSnipNode);

        const allFragmentUris: vscode.Uri[][] = [];

        // Asynchronously copy all the fragments inside of the source chapter into the (newly created) destination
        //      chapter
        const srcFragments = (src.data as ChapterNode).textData;
        const fragmentsConfigInfoPromises = Promise.all(srcFragments.map(fragment => {
            const fragmentOrdering = fragment.data.ids.ordering;
            return pasteFragment(fragment, copiedSnipNode, fragmentOrdering);
        }));

        // Asynchronously copy all the snips inside of the source chapter into the (newly created) destination
        //      chapter
        const srcSnips = ((src.data as ChapterNode).snips.data as ContainerNode).contents;
        const snipsConfigInfoPromises = Promise.all(srcSnips.map(snip => {
            const snipOrdering = snip.data.ids.ordering;
            return pasteSnip(snip, copiedChapterSnipsContainerNode, snipOrdering);
        }));


        const [ fragmentsConfigInfo, snipsConfigInfo ] = await Promise.all([ 
            fragmentsConfigInfoPromises,
            snipsConfigInfoPromises
        ]);
        

        // Copy config info for all the new fragments into fragment config for the newly copied snip
        const chapterFragmentsConfig: { [index: string]: ConfigFileInfo } = {};
        for (const { fileName, config, fragmentUris }  of fragmentsConfigInfo) {
            chapterFragmentsConfig[fileName] = config;
            allFragmentUris.push(fragmentUris);
        }

        // Copy config info for all the new fragments into fragment config for the newly copied snip
        const chapterSnipsConfig: { [index: string]: ConfigFileInfo } = {};
        for (const { fileName, config, fragmentUris }  of snipsConfigInfo) {
            chapterSnipsConfig[fileName] = config;
            allFragmentUris.push(fragmentUris);
        }

        // Write the .config for chapter fragments to disk
        const chapterFragmentsDotConfigUri = vscodeUris.Utils.joinPath(copiedChapterFullUri, '.config');
        const writeChapterFragmentsDotConfigPromise = writeDotConfig(chapterFragmentsDotConfigUri, chapterFragmentsConfig);
        awaitables.push(writeChapterFragmentsDotConfigPromise);

        // Write the .config for the chapter snips
        const chapterSnipsDotConfigUri = vscodeUris.Utils.joinPath(copiedChapterSnipsContainerUri, '.config');
        const writeChapterSnipsDotConfigPromise = writeDotConfig(chapterSnipsDotConfigUri, chapterSnipsConfig);
        awaitables.push(writeChapterSnipsDotConfigPromise);

        await Promise.all(awaitables);
        return {
            fileName: newFileName, 
            config: chapterConfig,
            fragmentUris: allFragmentUris.flat()
        };

    };
    //#endregion

    // Get information about the current paste
    const pasteData = await getContainerAndPastables();

    // If the destination for this paste has already been used during this current
    //      paste, then skip the current paste
    if (pasteLog[pasteData.destination.data.ids.uri.fsPath] === 1) return null;
    
    let pasteFunction: (src: OutlineNode, dest: OutlineNode, ordering: number) => Promise<PasteResult>;
    switch (pasteData.pasteType) {
        case 'chapter': pasteFunction = pasteChapter; break;
        case 'snip':  pasteFunction = pasteSnip; break;
        case 'fragment': pasteFunction = pasteFragment; break;
    }
    
    // Read configuration info for pasted content
    const destinationConfigUri = vscodeUris.Utils.joinPath(
        pasteData.destination.data.ids.uri,
        '.config'
    );
    const destinationConfig = await readDotConfig(destinationConfigUri);
    if (!destinationConfig) return null;

    const allFragmentUris: vscode.Uri[][] = [];

    // Iterate over pastables and copy their disk contents as well as 
    //      internal data into the destination found aboce
    let latestPasteOrdering = getLatestOrdering(destinationConfig);
    for (const pasteable of pasteData.pastables) {
        const nextPasteOrdering = latestPasteOrdering + 1;
        latestPasteOrdering = nextPasteOrdering;

        // Paste the node and recieve its configuration info67
        const { fileName, config, fragmentUris } = await pasteFunction (
            pasteable, 
            pasteData.destination,
            nextPasteOrdering
        );

        // Add the new item to the parent config file
        destinationConfig[fileName] = config;

        // Add all fragments
        allFragmentUris.push(fragmentUris);
    }

    // Then save the updated config
    await writeDotConfig(destinationConfigUri, destinationConfig);
    this.refresh(false, [ destination ]);

    // Simulate as if each of the pasted documents have been opened by calling the FileAccessManage
    allFragmentUris.flat().forEach(uri => {
        FileAccessManager.documentOpened(uri);
    });

    return pasteData.destination.data.ids.uri;
}
