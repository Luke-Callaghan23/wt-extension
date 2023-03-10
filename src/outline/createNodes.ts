/* eslint-disable curly */
import * as vscode from 'vscode';
import { ConfigFileInfo, readDotConfig, getLatestOrdering, writeDotConfig } from '../help';
import { ChapterNode, OutlineNode, RootNode } from './outlineNodes';
import { OutlineView } from './outlineView';
import * as console from '../vsconsole';
import * as extension from '../extension';
import { v4 as uuidv4 } from 'uuid';
import { FileAccessManager } from '../fileAccesses';

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
    _resource: OutlineNode | undefined, 
    options?: CreateOptions
): Promise<vscode.Uri | null> {
    // Creating a new chapter is simple as new chapters are the "highest" level in the node structure
    // No need to look at parent ids or anything
    // Just create a new chapter folder with a new text fragment and an empty snips folder and we're all done
    
    // Path and file name for new chapter
    const fileName = getUsableFileName(`chapter`);			// file name is chapter-timestamp to ensure uniqueness
    
    const chapterDataContainerRelativePath = `/data/chapters/`;
    const chapterDataRelativePath = `${chapterDataContainerRelativePath}/${fileName}`;

    // Read the .config file for all chapters
    const chapterDotConfigUri = vscode.Uri.joinPath(extension.rootPath, chapterDataContainerRelativePath, `.config`);
    const chapterDotConfig = await readDotConfig(chapterDotConfigUri);
    if (!chapterDotConfig) return null;

    // Create a generic chapter name for the new file
    const latestChapter = getLatestOrdering(chapterDotConfig);
    const newChapterNumber = latestChapter + 1;
    const newChapterName = options?.defaultName ?? `New Chapter (${newChapterNumber})`;

    // Store the chapter name and write it to disk
    chapterDotConfig[fileName] = {
        title: newChapterName,
        ordering: newChapterNumber
    };
    await writeDotConfig(chapterDotConfigUri, chapterDotConfig);

    // New fragment's file name and path
    const fragmentFileName = getUsableFileName(`fragment`, true);
    const fragmentRelativePath = `${chapterDataRelativePath}/${fragmentFileName}`;
    
    // Chapter's snip container file name and path
    const snipsContainerName = 'snips';
    const snipsContainerRelativePath = `${chapterDataRelativePath}/${snipsContainerName}`;
    const snipsDotConfigRelativePath = `${snipsContainerRelativePath}/.config`;
    
    // Now, create all the files
    const chapterContainerUri = vscode.Uri.joinPath(extension.rootPath, chapterDataRelativePath);
    try {
        // Chapter container
        await vscode.workspace.fs.createDirectory(chapterContainerUri);

        // Snip container
        const snipsContainerUri = vscode.Uri.joinPath(extension.rootPath, snipsContainerRelativePath);
        await vscode.workspace.fs.createDirectory(snipsContainerUri);
        
        // Write an empty .config object for this chapter's snips container
        const snipsUri = vscode.Uri.joinPath(extension.rootPath, snipsDotConfigRelativePath);
        await writeDotConfig(snipsUri, {});
        
        const fragmentDotConfigRelativePath = `${chapterDataRelativePath}/.config`;
        let fragmentsDotConfig: { [index: string]: ConfigFileInfo } = {};
        // Create the fragment, as long as it is not being skipped
        if (!options?.skipFragment) {
            // Chapter fragment
            const chapterFragmentUri = vscode.Uri.joinPath(extension.rootPath, fragmentRelativePath);
            await vscode.workspace.fs.writeFile(chapterFragmentUri, new Uint8Array());
    
            // Data for the .config file to store fragment names
            fragmentsDotConfig = {
                [fragmentFileName]: {
                    title: 'New Fragment',
                    ordering: 0,
                }
            };
        }
        
        // Write the .config for this chapter's fragments
        const chapterFragmentsDotConfigUri = vscode.Uri.joinPath(extension.rootPath, fragmentDotConfigRelativePath);
        await writeDotConfig(chapterFragmentsDotConfigUri, fragmentsDotConfig);
    }
    catch (e) {
        vscode.window.showErrorMessage(`And error occurred while creating a new chapter: ${e}`);
        return null;
    }

    if (!options?.preventRefresh) {
        vscode.window.showInformationMessage(`Successfully created new chapter with name 'New Chapter' (file name: ${fileName})`);
        this.refresh();
    }
    return chapterContainerUri;
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
        parentNode = (this.tree.data as RootNode).snips;
    }
    else {
        switch (resource.data.ids.type) {
            case 'snip':
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
                        const rootNode: OutlineNode = await this._getTreeElement(resource.data.ids.parentInternalId);
                        const root: RootNode = rootNode.data as RootNode;

                        // Check the id of the chapters container and the work snips container of the root node against
                        //		the id of the selected resource
                        if (resource.data.ids.internal === (root.chapters as OutlineNode).data.ids.internal) {
                            // If the id matches against the chapters container, then there's nothing we can do
                            // Cannot add snips to the chapters container
                            vscode.window.showErrorMessage('Error: cannot add a new snip directly to the chapters container.  Select a specific chapter to add the new snip to.');
                            return null;
                        }
                        else if (resource.data.ids.internal === (root.snips as OutlineNode).data.ids.internal) {
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
    
    const parentDirUri = vscode.Uri.joinPath(extension.rootPath, parentNode.data.ids.relativePath, parentNode.data.ids.fileName);
    
    // Add the new snip to the parent container's .config file

    // Read .config
    const snipsDotConfigUri = vscode.Uri.joinPath(parentDirUri, `.config`);
    const snipsDotConfig = await readDotConfig(snipsDotConfigUri);
    if (!snipsDotConfig) return null;

    // Update .config with the new snip, and write it back to disk
    const snipContainerFileName = getUsableFileName('snip');
    const latestSnipNumber = getLatestOrdering(snipsDotConfig);
    const newSnipNumber = latestSnipNumber + 1;
    snipsDotConfig[snipContainerFileName] = {
        title: options?.defaultName ?? `New Snip (${newSnipNumber})`,
        ordering: newSnipNumber
    };
    await writeDotConfig(snipsDotConfigUri, snipsDotConfig);
    
    // Create the snip container
    const snipUri = vscode.Uri.joinPath(parentDirUri, snipContainerFileName);
    try {
        await vscode.workspace.fs.createDirectory(snipUri);
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error creating snip file: could not create snip container.  Error: ${e}.`);
        return null;
    }
    
    const fragmentsDotConfigUri = vscode.Uri.joinPath(snipUri, `.config`);
    let fragmentsDotConfig: { [index: string]: ConfigFileInfo } = {};

    // If not skipping the creation of the fragment, then create a blank fragment inside of the 
    //      new snip
    if (!options?.skipFragment) {
        // Create a new fragment file for this snip
        const snipFragmentFileName = getUsableFileName(`fragment`, true);
        const fragmentFileUri = vscode.Uri.joinPath(snipUri, snipFragmentFileName);
    
        // Create the fragment file 
        try {
            await vscode.workspace.fs.writeFile(fragmentFileUri, new Uint8Array());
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error writing new fragment file for snip.  Error: ${e}.`);
            return null;
        }
        
        // Write the .config file for the new snips' fragments
        fragmentsDotConfig = {
            [snipFragmentFileName]: {
                title: 'New Fragment (0)',
                ordering: 0,
            }
        };
    }

    // Write the .config file for fragments of this snip
    await writeDotConfig(fragmentsDotConfigUri, fragmentsDotConfig);

    if (!options?.preventRefresh) {
        this.refresh();
        vscode.window.showInformationMessage('Successfully created new snip');
    }
    return snipUri;
}

export async function newFragment (
    this: OutlineView, 
    resource: OutlineNode | undefined, 
    options?: CreateOptions
): Promise<vscode.Uri | null> {
    if (!resource) {
        console.log("1");
        // If there is no selected resource, get the last opened file access from the FileAccessManager
        const lastAccessedFragmentUri = FileAccessManager.lastAccess;
        if (lastAccessedFragmentUri === undefined) {
            console.log("  1.1");
            vscode.window.showErrorMessage('Error cannot tell where to place the new fragment.  Please open a fragment file or select an item in the outline panel to create a new fragment.');
            return null;
        }
        
        // If there is a last accessed fragment, use that
        resource = await this._getTreeElementByUri(lastAccessedFragmentUri);
        if (!resource) {
            console.log("  1.2");
            vscode.window.showErrorMessage('Error cannot tell where to place the new fragment.  Please open a fragment file or select an item in the outline panel to create a new fragment.');
            return null;
        }
    }

    // Need to know the uri of the new fragment's parent so that we can insert the new file into it
    let parentId: string;
    let parentNode: OutlineNode;
    if (resource.data.ids.type === 'fragment') {
        // If the selected resource is a fragment itself, then look at the parent node of that fragment
        parentId = resource.data.ids.parentInternalId;
        parentNode = await this._getTreeElement(parentId);
    }
    else if (resource.data.ids.type === 'container') {
        console.log("2");
        // Get the last fragment of the selected container that was accessed
        const lastAccessedFragmentInContainerUri = FileAccessManager.containerLastAccessedDocument(resource);
        resource = await this._getTreeElementByUri(lastAccessedFragmentInContainerUri);
        if (!resource) {
            console.log("  2.1");
            // Since a container is a something that holds other folder nodes, you cannot add a fragment direcly to a container
            vscode.window.showErrorMessage('Error cannot tell where to place the new fragment.  Please open a fragment file or select an item in the outline panel to create a new fragment.');
            return null;
        }

        // Get the parent of that last accessed fragment to use as the house of the new fragment
        parentId = resource.data.ids.parentInternalId;
        parentNode = await this._getTreeElement(parentId);

    }
    else {
        // Otherwise, use the resource itself as the parent of the new fragment
        parentId = resource.data.ids.internal;
        parentNode = resource;
    }

    // New fragment's file name and path
    const fragmentFileName = getUsableFileName(`fragment`, true);
    const fragmentContainerRelativePath = `${parentNode.data.ids.relativePath}/${parentNode.data.ids.fileName}`;
    const fragmentRelativePath = `${fragmentContainerRelativePath}/${fragmentFileName}`;

    // Read the .config object for this fragment container
    const fragmentDotConfigUri = vscode.Uri.joinPath(extension.rootPath, fragmentContainerRelativePath, `.config`);
    const fragmentDotConfig = await readDotConfig(fragmentDotConfigUri);
    if (!fragmentDotConfig) return null;

    // Get the fragment number for this fragment
    const latestFragmentNumber = getLatestOrdering(fragmentDotConfig);
    const newFragmentNumber = latestFragmentNumber + 1;

    // Add the new fragment name to the fragment config, and re-write it to the disk
    fragmentDotConfig[fragmentFileName] = {
        title: options?.defaultName ?? `New Fragment (${newFragmentNumber})`,
        ordering: newFragmentNumber
    };
    await writeDotConfig(fragmentDotConfigUri, fragmentDotConfig);

    // Write the fragment file
    const fragmentUri = vscode.Uri.joinPath(extension.rootPath, fragmentRelativePath);
    try {
        await vscode.workspace.fs.writeFile(fragmentUri, new Uint8Array());
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error creating new fragment file: ${e}.`);
    }

    if (!options?.preventRefresh) {
        this.refresh();
        console.log(fragmentUri);
        vscode.window.showTextDocument(fragmentUri);
        vscode.window.showInformationMessage('Successfully created new fragment');
    }
    return fragmentUri;
}