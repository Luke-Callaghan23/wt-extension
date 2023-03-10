/* eslint-disable curly */
import * as vscode from 'vscode';
import * as console from './../../vsconsole';
import { createWorkspace, Workspace } from './../workspace';
import { ChaptersRecord, FragmentRecord, SnipsRecord, WorkspaceExport } from './types';
import { getUsableFileName } from '../../outline/createNodes';
import { ConfigFileInfo } from '../../help';
import * as extension from './../../extension';

async function initializeFragments (
    fragments: FragmentRecord, 
    parentUri: vscode.Uri,         // assumes the caller has created this directory already
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
        const fragmentUri = vscode.Uri.joinPath(parentUri, fragmentFilename);
        const fragmentMarkdown = fragmentRecord.markdown;
        ordering++;
        return vscode.workspace.fs.writeFile(fragmentUri, Buffer.from(fragmentMarkdown, 'utf-8'));
    }));

    // Save the config file in the same location as the fragments
    const dotConfigUri = vscode.Uri.joinPath(parentUri, `.config`);
    const dotConfigJSON = JSON.stringify(configMap);
    await vscode.workspace.fs.writeFile(dotConfigUri, Buffer.from(dotConfigJSON, 'utf-8'));
}

async function initializeSnips (
    snips: SnipsRecord,
    parentUri: vscode.Uri,
): Promise<void> {
    
    const configMap: { [ index: string ]: ConfigFileInfo } = {};
    let ordering: number = 0;

    // Iterate over snip records
    for (const snipRecord of snips) {

        // Create the folder for the snip
        const snipFileName = getUsableFileName('snip');
        const snipFolderUri = vscode.Uri.joinPath(parentUri, snipFileName);
        await vscode.workspace.fs.createDirectory(snipFolderUri);

        // Insert config info for this snip
        const snipConfig = {
            title: snipRecord.title,
            ordering: ordering
        } as ConfigFileInfo;
        configMap[snipFileName] = snipConfig;

        // Create the fragments
        return initializeFragments(snipRecord.fragments, snipFolderUri);
    }

    // Save the config file in the same location as the snip folders
    const dotConfigUri = vscode.Uri.joinPath(parentUri, `.config`);
    const dotConfigJSON = JSON.stringify(configMap);
    await vscode.workspace.fs.writeFile(dotConfigUri, Buffer.from(dotConfigJSON, 'utf-8'));
}

async function initializeChapters (
    chapters: ChaptersRecord,
    parentUri: vscode.Uri,
) {
    const configMap: { [ index: string ]: ConfigFileInfo } = {};
    let ordering: number = 0;

    // Iterate over chapter records
    for (const chapterRecord of chapters) {

        // Create the folder for the chapter
        const chapterFileName = getUsableFileName('chapter');
        const chapterFolderUri = vscode.Uri.joinPath(parentUri, chapterFileName);
        await vscode.workspace.fs.createDirectory(chapterFolderUri);

        // Insert config info for this chapter
        const chapterConfig = {
            title: chapterRecord.title,
            ordering: ordering
        } as ConfigFileInfo;
        configMap[chapterFileName] = chapterConfig;

        // Create the snips
        await initializeSnips(chapterRecord.snips, chapterFolderUri);

        // Create the fragments
        await initializeFragments(chapterRecord.fragments, chapterFolderUri);
    };

    
    // Save the config file in the same location as the chapters folder
    const dotConfigUri = vscode.Uri.joinPath(parentUri, `.config`);
    const dotConfigJSON = JSON.stringify(configMap);
    await vscode.workspace.fs.writeFile(dotConfigUri, Buffer.from(dotConfigJSON, 'utf-8'));
}

async function initializeContextItems (context: vscode.ExtensionContext, packageableItems: { [index: string]: any }) {
    await Promise.all(Object.entries(packageableItems).map(([contextKey, contextItem]) => {
        return [
            context.workspaceState.update(contextKey, contextItem),
            vscode.commands.executeCommand ('setContext', contextKey, contextItem),
        ]
    }).flat());
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
    const iweRecordBuffer: Uint8Array = await vscode.workspace.fs.readFile(uri);
    const iweRecord: WorkspaceExport = JSON.parse(extension.decoder.decode(iweRecordBuffer));

    // Create the workspace
    const workspace = await createWorkspace(context, iweRecord.config);
    workspace.config = iweRecord.config;

    // Save the .wtconfig of the workspace
    const dotWtconfigJSON = JSON.stringify(iweRecord.config);
    const dotConfigUri = workspace.dotWtconfigPath;
    await vscode.workspace.fs.writeFile(dotConfigUri, Buffer.from(dotWtconfigJSON, 'utf-8'));

    // Create all chapters
    const chapterContainer = workspace.chaptersFolder;
    await initializeChapters(iweRecord.chapters, chapterContainer);

    // Create all work snips
    const workSnipsContainer = workspace.workSnipsFolder;
    await initializeSnips(iweRecord.snips, workSnipsContainer);

    // Insert packageable workspace items into the current workspace context
    await initializeContextItems(context, iweRecord.packageableItems);

    context.workspaceState.update('wt.todo.enabled', iweRecord.packageableItems['wt.todo.enabled']);
    context.workspaceState.update('wt.wordWatcher.enabled', iweRecord.packageableItems['wt.wordWatcher.enabled']);
    context.workspaceState.update('wt.proximity.enabled', iweRecord.packageableItems['wt.proximity.enabled']);

    return workspace;
}