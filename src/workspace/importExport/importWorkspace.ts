/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as console from './../../vsconsole';
import { createWorkspace, Workspace } from './../workspace';
import { ChaptersRecord, FragmentRecord, SnipsRecord, WorkspaceExport } from './types';
import { getUsableFileName } from '../../panels/treeViews/outline/createNodes';
import { ConfigFileInfo } from '../../help';
import * as extension from './../../extension';

async function initializeFragments (
    fragments: FragmentRecord, 
    parentFullPath: string,         // assumes the caller has created this directory already
): Promise<void> {
    
    const configMap: { [ index: string ]: ConfigFileInfo } = {};
    let ordering: number = 0;

    // Iterate over fragments
    await Promise.all(fragments.map(fragmentRecord => {
        
        // Create a file name, and add the the config to the returned map of config info
        const fragmentFilename = getUsableFileName('fragment', true);
        const fileConfig: ConfigFileInfo = {
            ordering: ordering,
            title: fragmentRecord.title
        };
        configMap[fragmentFilename] = fileConfig;

        // Create the fragment file
        const fragmentFullPath = `${parentFullPath}/${fragmentFilename}`;
        const fragmentMarkdown = fragmentRecord.markdown;
        ordering++;
        return fs.promises.writeFile(fragmentFullPath, fragmentMarkdown);
    }));

    // Save the config file in the same location as the fragments
    const dotConfigFullPath = `${parentFullPath}/.config`;
    const dotConfigJSON = JSON.stringify(configMap);
    await fs.promises.writeFile(dotConfigFullPath, dotConfigJSON);
}

async function initializeSnips (
    snips: SnipsRecord,
    parentFullPath: string,
): Promise<void> {
    
    const configMap: { [ index: string ]: ConfigFileInfo } = {};
    let ordering: number = 0;

    // Iterate over snip records
    await Promise.all(snips.map(snipRecord => {

        // Create the folder for the snip
        const snipFileName = getUsableFileName('snip');
        const snipFolderFullPath = `${parentFullPath}/${snipFileName}`;
        fs.mkdirSync(snipFolderFullPath);

        // Insert config info for this snip
        const snipConfig = {
            title: snipRecord.title,
            ordering: ordering
        } as ConfigFileInfo;
        configMap[snipFileName] = snipConfig;

        // Create the fragments
        return initializeFragments(snipRecord.fragments, snipFolderFullPath);
    }));

    // Save the config file in the same location as the snip folders
    const dotConfigFullPath = `${parentFullPath}/.config`;
    const dotConfigJSON = JSON.stringify(configMap);
    await fs.promises.writeFile(dotConfigFullPath, dotConfigJSON);
}

async function initializeChapters (
    chapters: ChaptersRecord,
    parentFullPath: string,
) {
    const configMap: { [ index: string ]: ConfigFileInfo } = {};
    let ordering: number = 0;

    // Iterate over chapter records
    for (const chapterRecord of chapters) {

        // Create the folder for the chapter
        const chapterFileName = getUsableFileName('chapter');
        const chapterFolderFullPath = `${parentFullPath}/${chapterFileName}`;
        await fs.promises.mkdir(chapterFolderFullPath);

        // Insert config info for this chapter
        const chapterConfig = {
            title: chapterRecord.title,
            ordering: ordering
        } as ConfigFileInfo;
        configMap[chapterFileName] = chapterConfig;

        // Create the snips
        await initializeSnips(chapterRecord.snips, chapterFolderFullPath);

        // Create the fragments
        await initializeFragments(chapterRecord.fragments, chapterFolderFullPath);
    };

    
    // Save the config file in the same location as the chapters folder
    const dotConfigFullPath = `${parentFullPath}/.config`;
    const dotConfigJSON = JSON.stringify(configMap);
    await fs.promises.writeFile(dotConfigFullPath, dotConfigJSON);
}

async function initializeContextItems (packageableItems: { [index: string]: any }) {
    await Promise.all(Object.entries(packageableItems).map(([contextKey, contextItem]) => {
        return vscode.commands.executeCommand ('setContext', contextKey, contextItem);
    }));
}



// Function for importing a workspace from an .iwe file
export async function importWorkspace (context: vscode.ExtensionContext): Promise<Workspace | null> {

    // Request the user to select their .iwe file
    const uris = await vscode.window.showOpenDialog({
        title: 'Select the .iwe file you would like to import.',
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Integrated Writing Environment': ['iwe']
        }
    });
    // Make sure that the selected item is exactly one file
    if (!uris) return null;
    if (uris.length !== 1) return null;

    // Read the .iwe file form the disk
    const uri = uris[0];
    const iweRecordBuffer: Buffer = await fs.promises.readFile(uri.fsPath);
    const iweRecord: WorkspaceExport = JSON.parse(iweRecordBuffer.toString());

    // Create the workspace
    const workspace = await createWorkspace(context, iweRecord.config);
    workspace.config = iweRecord.config;

    // Save the .wtconfig of the workspace
    const dotWtconfigJSON = JSON.stringify(iweRecord.config);
    await fs.promises.writeFile(workspace.dotWtconfigPath, dotWtconfigJSON);

    // Create all chapters
    const chapterContainer = workspace.chaptersFolder;
    await initializeChapters(iweRecord.chapters, chapterContainer);

    // Create all work snips
    const workSnipsContainer = workspace.workSnipsFolder;
    await initializeSnips(iweRecord.snips, workSnipsContainer);

    // Insert packageable workspace items into the current workspace context
    await initializeContextItems(iweRecord.packageableItems);

    workspace.todosEnabled = iweRecord.packageableItems['wt.todo.enabled'];
    workspace.proximityEnabled = iweRecord.packageableItems['wt.proximity.enabled'];
    workspace.wordWatcherEnabled = iweRecord.packageableItems['wt.wordWatcher.enabled'];

    return workspace;
}