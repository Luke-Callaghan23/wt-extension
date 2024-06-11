/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { ConfigFileInfo, readDotConfig, getLatestOrdering, writeDotConfig } from '../../help';
import { ChapterNode, OutlineNode, RootNode, ContainerNode, SnipNode, FragmentNode } from '../nodes_impl/outlineNode';
import { OutlineView } from '../outlineView';
// import * as console from '../../vsconsole';
import * as extension from '../../extension';
import { v4 as uuidv4 } from 'uuid';
import { FileAccessManager } from '../../fileAccesses';
import { InitializeNode, initializeChapter, initializeFragment, initializeSnip } from '../../outlineProvider/initialize';
import { NodeTypes } from '../../outlineProvider/fsNodes';

export function getUsableFileName (fileTypePrefix: string, wt?: boolean): string {
    const fileTypePostfix = wt ? '.wt' : '';
    return `${fileTypePrefix}-${Date.now()}-${uuidv4()}${fileTypePostfix}`;
}

type CreateOptions = {
    preventRefresh?: boolean,
    defaultName?: string,
    skipFragment?: boolean
};

export async function newChapter (
    this: OutlineView, 
    resource: OutlineNode | undefined, 
    options?: CreateOptions
): Promise<vscode.Uri | null> {
    // Creating a new chapter is simple as new chapters are the "highest" level in the node structure
    // No need to look at parent ids or anything
    // Just create a new chapter folder with a new text fragment and an empty snips folder and we're all done
    
    // Path and file name for new chapter
    
    const chaptersContainer = (this.rootNodes[0].data as RootNode).chapters;
    const chaptersContainerUri = chaptersContainer.getUri();

    const chaptersContainerDotConfigUri = vscodeUris.Utils.joinPath(chaptersContainerUri, '.config');
    const chaptersContainerDotConfig = await readDotConfig(chaptersContainerDotConfigUri);
    if (!chaptersContainerDotConfig) return null; 
    
    // Create a generic chapter name for the new file
    const latestChapter = getLatestOrdering(chaptersContainerDotConfig);
    const chapterNumber = latestChapter + 1;
    const chapterTitle = options?.defaultName ?? `New Chapter (${chapterNumber})`;
    const chapterFileName = getUsableFileName(`chapter`);
    const chapterUri = vscodeUris.Utils.joinPath(chaptersContainerUri, chapterFileName);
    const chapterFragmentsDotConfigUri = vscodeUris.Utils.joinPath(chapterUri, '.config');
    const chapterRelativePath = `${chaptersContainer.data.ids.relativePath}/${chaptersContainer.data.ids.fileName}`;

    // Store the chapter name and write it to disk
    chaptersContainerDotConfig[chapterFileName] = {
        title: chapterTitle,
        ordering: chapterNumber
    };
    const chaptersWriteDotConfigPromise = writeDotConfig(chaptersContainerDotConfigUri, chaptersContainerDotConfig);

    // Array of awaitable promises that can be performed in the background -- don't have to worry about awaiting them
    //      at the time, but should await them by the end
    const awaitables: (Promise<any> | Thenable<any>)[] = [ chaptersWriteDotConfigPromise ];

    // Information about the container of this chapter's snip nodes
    const snipsContainerFileName = 'snips';
    const snipsContainerUri = vscodeUris.Utils.joinPath(chapterUri, snipsContainerFileName);
    const snipsContainerDotConfigUri = vscodeUris.Utils.joinPath(snipsContainerUri, `.config`);

    const snipContainerNode = <ContainerNode> {
        ids: {
            display: 'Snips',
            fileName: snipsContainerFileName,
            ordering: 1000000,
            parentTypeId: 'chapter',
            parentUri: chapterUri,
            relativePath: `${chapterRelativePath}/${snipsContainerFileName}`,
            type: 'container',
            uri: snipsContainerUri
        },
        contents: [],
    };
    const snipContainer = new OutlineNode(snipContainerNode);

    const chapterNode = <ChapterNode> {
        ids: {
            display: chapterTitle,
            fileName: chapterFileName,
            ordering: chapterNumber,
            parentTypeId: 'container',
            parentUri: chaptersContainerUri,
            relativePath: chapterRelativePath,
            type: 'chapter',
            uri: chapterUri
        },
        snips: snipContainer,
        textData: []
    };
    
    try {
        // Chapter root folder
        await vscode.workspace.fs.createDirectory(chapterUri);

        // Snip's snip container
        await vscode.workspace.fs.createDirectory(snipsContainerUri);
        
        // Write an empty .config object for this chapter's snips container
        const snipsWriteDotConfigPromise = writeDotConfig(snipsContainerDotConfigUri, {});
        awaitables.push(snipsWriteDotConfigPromise);
        
        const fragmentsDotConfig: { [index: string]: ConfigFileInfo } = {};
        // Create the fragment, as long as it is not being skipped
        if (!options?.skipFragment) {
            
            
            // New fragment's file name and path
            const fragmentFileName = getUsableFileName(`fragment`, true);
            const fragmentUri = vscodeUris.Utils.joinPath(chapterUri, fragmentFileName);
            const fragmentTitle = 'New Fragment';

            // Write an empty fragment inside of the chapter's root folder
            await vscode.workspace.fs.writeFile(fragmentUri, new Uint8Array());

            // Data for the .config file to store fragment names
            fragmentsDotConfig[fragmentFileName] = {
                title: fragmentTitle,
                ordering: 0,
            };

            // Create internal data to represent this fragment in the outline tree
            const fragmentNode = <FragmentNode> {
                ids: {
                    display: fragmentTitle,
                    fileName: fragmentFileName,
                    ordering: 0,
                    parentTypeId: 'chapter',
                    parentUri: chapterUri,
                    relativePath: `${chapterRelativePath}/${chapterFileName}`,
                    type: 'fragment',
                    uri: fragmentUri
                },
                md: ''
            };

            // Push the fragment data inside of the chapter node's data tree
            const fragment = new OutlineNode(fragmentNode);
            chapterNode.textData.push(fragment);
            
            // Open the text document in the editor as well
            if (!options?.preventRefresh) {
                vscode.window.showTextDocument(fragmentUri);
            }
        }
        
        // Write the .config for this chapter's fragments
        const fragmentsWriteDotConfigPromise = writeDotConfig(chapterFragmentsDotConfigUri, fragmentsDotConfig);
        awaitables.push(fragmentsWriteDotConfigPromise);
    }
    catch (e) {
        vscode.window.showErrorMessage(`And error occurred while creating a new chapter: ${e}`);
        return null;
    }
    
    // Push the new chapter to the chapter container
    const chapter = new OutlineNode(chapterNode);
    (chaptersContainer.data as ContainerNode).contents.push(chapter);

    if (!options?.preventRefresh) {
        vscode.window.showInformationMessage(`Successfully created new chapter with name 'New Chapter' (file name: ${chapterFileName})`);
        this.refresh(false, [ chaptersContainer ]);
    }

    await Promise.all(awaitables);
    return chapterUri;
}

export async function newSnip (
    this: OutlineView, 
    resource: OutlineNode | undefined, 
    options?: CreateOptions
): Promise<vscode.Uri | null> {
    
    // Need to determine where the snip is going to go
    // If the current resource is a snip or a fragment, insert the snip in the nearest chapter/root that parents that fragment
    // If the current resource is a chapter, insert the snip in that chapter
    // If the current resource is unavailable, insert the snip in the work snips folder

    let parentNode: OutlineNode;
    if (!resource) {

        // If the selected resource is `undefined`, then search for the the container
        //      of the latest accessed fragment
        // Using the work snips container as a fallback
        const fallback = (this.rootNodes[0].data as RootNode).snips;

        // Get the closest snip container to the latest accessed snip:
        const latestAccessedFragment = FileAccessManager.lastAccessedFragment;
        if (!latestAccessedFragment) {
            parentNode = fallback;
        }
        else {
            // Case: there is a latest accessed fragment
            const fragmentNode: OutlineNode | undefined | null = await this.getTreeElementByUri(latestAccessedFragment);
            if (!fragmentNode) {
                parentNode = fallback;
            }
            else {
                // Case: fragment has a corresponding node in the outline view
                const fragmentContainerUri = fragmentNode.data.ids.parentUri;
                const fragmentContainer: OutlineNode | undefined | null = await this.getTreeElementByUri(fragmentContainerUri);
                if (!fragmentContainer) {
                    parentNode = fallback;
                }
                // Cases: fragment has a corresponding container
                // If the parent of the latest accessed container is chapter, use
                //      the snips container of that chapter as the destination of this
                //      new snip
                else if (fragmentContainer.data.ids.type === 'chapter') {
                    parentNode = (fragmentContainer.data as ChapterNode).snips;
                }
                // If the parent of the latest accessed container is a snip, use
                //      the parent container of that snip as the destination
                else if (fragmentContainer.data.ids.type === 'snip') {
                    const snipsContainerUri = fragmentContainer.data.ids.parentUri;
                    const snipsContainer: OutlineNode | undefined | null = await this.getTreeElementByUri(snipsContainerUri);
                    if (!snipsContainer) {
                        parentNode = fallback;
                    }
                    else {
                        parentNode = snipsContainer;
                    }
                }
                else throw 'Not reachable';
            }
        }
    }
    else {
        switch (resource.data.ids.type) {
            case 'snip':
                {
                    parentNode = resource;
                    break;
                }
            case 'fragment':
                {
                    const chapterOrRoot = (await resource.getContainerParent(this)).data as ChapterNode | RootNode;
                    parentNode = chapterOrRoot.snips as OutlineNode;
                    break;
                }
            case 'container':
                {
                    // When the node is a container type, it is either a container of: work snips, chapters, or chapter snips
                    // Need to check the parent node to see where we should add the new snip
                    if (resource.data.ids.parentTypeId === 'root') {
                        // If the parent type is root, we still don't know if the selected item is a chapter container
                        //		or the work snips
                        // Need to check the ids of each of these containers against the id of the resource
                        const rootNode: OutlineNode = await this.getTreeElementByUri(resource.data.ids.parentUri);
                        const root: RootNode = rootNode.data as RootNode;

                        // Check the id of the chapters container and the work snips container of the root node against
                        //		the id of the selected resource
                        if (resource.data.ids.uri.toString() === (root.chapters as OutlineNode).data.ids.uri.toString()) {
                            // If the id matches against the chapters container, then there's nothing we can do
                            // Cannot add snips to the chapters container
                            vscode.window.showErrorMessage('Error: cannot add a new snip directly to the chapters container.  Select a specific chapter to add the new snip to.');
                            return null;
                        }
                        else if (resource.data.ids.uri.toString() === (root.snips as OutlineNode).data.ids.uri.toString()) {
                            // If the id matches the work snips container, add the new snip to that container
                            parentNode = root.snips as OutlineNode;
                        }
                        else {
                            throw new Error('Not possible');
                        }
                    }
                    else if (resource.data.ids.parentTypeId === 'chapter') {
                        // If the parent to this container is chapter, then this container is the snips container for that chapter node
                        // Simply use this container itself as the parent node
                        parentNode = resource;
                    }
                    else {
                        throw new Error('Not possible.');
                    }
                    break;
                }
            case 'chapter':
                // If the type of this resource is a chapter, then use the .snips container of this chapter as the home of the new chapter
                const chapter: ChapterNode = (resource as OutlineNode).data as ChapterNode;
                parentNode = chapter.snips as OutlineNode;
                break;
            case 'root':
                throw new Error("Not possible");
        }
    }
    
    // Get the snips container that holds all the sibling snips of the new snip
    const parentUri = parentNode.getUri();
    const parentDotConfigUri = vscodeUris.Utils.joinPath(parentUri, '.config');
    if (!parentDotConfigUri) return null;

    const parentDotConfig = await readDotConfig(parentDotConfigUri);
    if (!parentDotConfig) return null;

    // Create configuration details for this snip

    // First get the `ordering` of this snip in its container
    // Its ordering will be the last in the container
    const latestSnipNumber = getLatestOrdering(parentDotConfig);
    const newSnipNumber = latestSnipNumber + 1;

    // Create a file name for this snip
    const snipFileName = getUsableFileName('snip');
    const snipTitle = options?.defaultName ?? `New Snip (${newSnipNumber})`;

    // Create config struct and write it to disk
    parentDotConfig[snipFileName] = {
        title: options?.defaultName ?? `New Snip (${newSnipNumber})`,
        ordering: newSnipNumber
    };
    // Don't await this yet as nothing after this relies on the disk write
    const writeSnipConfigPromise = writeDotConfig(parentDotConfigUri, parentDotConfig);
    
    // Create the folder which holds this new snip's content
    const snipUri = vscode.Uri.joinPath(parentUri, snipFileName);
    try {
        await vscode.workspace.fs.createDirectory(snipUri);
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error creating snip file: could not create snip container.  Error: ${e}.`);
        return null;
    }
    
    // Create .config file for this new snip
    const snipDotConfigUri = vscode.Uri.joinPath(snipUri, `.config`);
    const snipDotConfig: { [index: string]: ConfigFileInfo } = {};

    // Internal object which represents this snip:
    const snipNode = <SnipNode> {
        ids: {
            display: snipTitle,
            fileName: snipFileName,
            ordering: newSnipNumber,
            parentTypeId: parentNode.data.ids.type,
            parentUri: parentUri,
            relativePath: `${parentNode.data.ids.relativePath}/${parentNode.data.ids.fileName}`,
            type: 'snip',
            uri: snipUri
        },
        contents: []
    };

    // If not skipping the creation of the fragment, then create a blank fragment inside of the 
    //      new snip
    if (!options?.skipFragment) {
        // Create a new fragment file for this snip
        const fragmentFileName = getUsableFileName(`fragment`, true);
        const fragmentUri = vscode.Uri.joinPath(snipUri, fragmentFileName);
        const fragmentTitle = 'New Fragment (0)';
    
        // Create the fragment file 
        try {
            await vscode.workspace.fs.writeFile(fragmentUri, new Uint8Array());
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error writing new fragment file for snip.  Error: ${e}.`);
            return null;
        }

        // Internal object to represent the fragment in the outline view
        const fragmentNode = <FragmentNode> {
            ids: {
                display: fragmentTitle,
                fileName: fragmentFileName,
                ordering: 0,
                parentTypeId: 'snip',
                parentUri: snipUri,
                relativePath: `${snipNode.ids.relativePath}/${snipFileName}`,
                type: 'fragment',
                uri: fragmentUri
            },
            md: ''
        };

        // Push this fragment to the parent snip
        snipNode.contents.push(new OutlineNode(fragmentNode));
        
        // Write the .config file for the new snips' fragments
        snipDotConfig[fragmentFileName] = {
            title: fragmentTitle,
            ordering: 0,
        };

        // Open the text document in the editor as well
        if (!options?.preventRefresh) {
            vscode.window.showTextDocument(fragmentUri);
        }
    }

    // Write the .config file for fragments of this snip
    const writeFragmentConfigPromise = writeDotConfig(snipDotConfigUri, snipDotConfig);

    try {
        // Add snip node to parent node's snip's content array
        const snip = new OutlineNode(snipNode);
        (parentNode.data as ContainerNode).contents.push(snip);
    }
    catch (err: any) {
        console.log(err);
    }

    if (!options?.preventRefresh) {
        this.refresh(false, [ parentNode ]);
        vscode.window.showInformationMessage('Successfully created new snip');
    }

    // Await the dangling promises before continueing
    await Promise.all([ writeSnipConfigPromise, writeFragmentConfigPromise ]);
    return snipUri;
}

export async function newFragment (
    this: OutlineView, 
    resource: OutlineNode | undefined, 
    options?: CreateOptions
): Promise<vscode.Uri | null> {

    // If the root is the selected node or if there is no selected resource in the
    //      view, it's too ambiguous to decide the destination, instead default to 
    //      the last accessed fragment as the selected resource
    if (!resource || resource.data.ids.type === 'root') {
        const lastAccessedFragmentUri = FileAccessManager.lastAccessedFragment;
        if (lastAccessedFragmentUri === undefined) {
            vscode.window.showErrorMessage('Error cannot tell where to place the new fragment.  Please open a fragment file or select an item in the outline panel to create a new fragment.');
            return null;
        }
        
        // If there is a last accessed fragment, use that
        resource = await this.getTreeElementByUri(lastAccessedFragmentUri);
        if (!resource) {
            vscode.window.showErrorMessage('Error cannot tell where to place the new fragment.  Please open a fragment file or select an item in the outline panel to create a new fragment.');
            return null;
        }
    }

    // Need to know the uri of the new fragment's parent so that we can insert the new file into it
    let parentUri: vscode.Uri;
    let parentNode: OutlineNode;
    if (resource.data.ids.type === 'fragment') {
        // If the selected resource is a fragment itself, then look at the parent node of that fragment
        parentUri = resource.data.ids.parentUri;
        parentNode = await this.getTreeElementByUri(parentUri);
    }
    else if (resource.data.ids.type === 'container') {
        // Get the last fragment of the selected container that was accessed
        const lastAccessedFragmentInContainerUri = FileAccessManager.lastAccessedFragmentForUri(resource.data.ids.uri);
        resource = await this.getTreeElementByUri(lastAccessedFragmentInContainerUri);
        if (!resource) {
            // Since a container is a something that holds other folder nodes, you cannot add a fragment direcly to a container
            vscode.window.showErrorMessage('Error cannot tell where to place the new fragment.  Please open a fragment file or select an item in the outline panel to create a new fragment.');
            return null;
        }

        // Get the parent of that last accessed fragment to use as the house of the new fragment
        parentUri = resource.data.ids.parentUri;
        parentNode = await this.getTreeElementByUri(parentUri);

    }
    else {
        // Otherwise, use the resource itself as the parent of the new fragment
        parentUri = resource.data.ids.uri;
        parentNode = resource;
    }

    const fileName = getUsableFileName('fragment', true);

    const parentDotConfigUri = vscodeUris.Utils.joinPath(parentUri, `.config`);
    if (!parentDotConfigUri) return null;

    const parentDotConfig = await readDotConfig(parentDotConfigUri);
    if (!parentDotConfig) return null;

    // Initialize the snip with parent node's data

    
    // Get the fragment number for this fragment
    const latestFragmentNumber = getLatestOrdering(parentDotConfig);
    const newFragmentNumber = latestFragmentNumber + 1;

    const title = options?.defaultName ?? `New Fragment (${newFragmentNumber})`;

    // Write the fragment file
    const fragmentUri = vscodeUris.Utils.joinPath(parentUri, fileName);
    const fragment = <FragmentNode> {
        ids: {
            display: title,
            fileName: fileName,
            ordering: newFragmentNumber,
            parentTypeId: parentNode.data.ids.type,
            parentUri: parentUri,
            type: 'fragment',
            relativePath: `${parentNode.data.ids.relativePath}/${parentNode.data.ids.fileName}`,
            uri: fragmentUri
        },
        md: ''
    };

    // Add snip node to parent node's content array
    const fragmentNode = new OutlineNode(fragment);
    if (parentNode.data.ids.type === 'chapter') {
        (parentNode.data as ChapterNode).textData.push(fragmentNode);
    }
    else if (parentNode.data.ids.type === 'snip') {
        (parentNode.data as SnipNode).contents.push(fragmentNode);
    }

    parentDotConfig[fileName] = {
        ordering: newFragmentNumber,
        title: title
    }

    try {
        await vscode.workspace.fs.writeFile(fragmentUri, new Uint8Array());
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error creating new fragment file: ${e}.`);
    }

    await writeDotConfig(parentDotConfigUri, parentDotConfig);

    if (!options?.preventRefresh) {
        vscode.window.showTextDocument(fragmentUri);
        this.refresh(false, [ parentNode ]);
        vscode.window.showInformationMessage('Successfully created new fragment');
    }
    return fragmentNode.getUri();
}