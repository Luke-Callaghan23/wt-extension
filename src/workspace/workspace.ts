import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { prompt } from '../help';
import * as vsconsole from '../vsconsole';
import * as extension from '../extension';
import { gitiniter } from '../gitTransactions';
import { Buff } from '../Buffer/bufferSource';
import { Workspace } from './workspaceClass';


export type Config = {
    createDate: number;
    creator: string;
    title: string;
};

// Function for creating a new workspace in the root path of the user's vscode workspace
export async function createWorkspace (
    context: vscode.ExtensionContext,
    defaultConfig?: Config
): Promise<Workspace> {

    const workspace = new Workspace(context);

    if (!defaultConfig) {
        // Prompt the user for their name
        let creatorName = await prompt({
            placeholder: Math.random() > 0.5 ? 'John Doe' : 'Jane Doe',
            prompt: "What is your name?",
        });
    
        // Prompt the user for the title of their work
        let title = await prompt({
            placeholder: 'Hamlet',
            prompt: "Title your workspace:",
        });
    
        // Current timestamp
        const createTime = Date.now();
    
        // Create the config for this workspace
        const config: Config = {
            createDate: createTime,
            creator: creatorName,
            title: title
        };
        workspace.config = config;
    }
    else {
        workspace.config = defaultConfig;
    }


    try {
        // Create /.wtconfig
        const configJSON = JSON.stringify(workspace.config);

        const wtConfigUri = workspace.dotWtconfigPath;
        await vscode.workspace.fs.writeFile(wtConfigUri, Buff.from(configJSON, 'utf-8'));

        // Create the data container
        const dataUri = vscode.Uri.joinPath(extension.rootPath, `data`);
        await vscode.workspace.fs.createDirectory(dataUri);

        // Create necessary folders
        for (const folder of workspace.getFolders()) {
            await vscode.workspace.fs.createDirectory(folder);
        }

        // Create the .config files for chapters and snips
        const chaptersDotConfig = vscode.Uri.joinPath(workspace.chaptersFolder, `.config`);
        const snipsDotConfig = vscode.Uri.joinPath(workspace.workSnipsFolder, `.config`);
        await vscode.workspace.fs.writeFile(chaptersDotConfig, Buff.from('{}', 'utf-8'));
        await vscode.workspace.fs.writeFile(snipsDotConfig, Buff.from('{}', 'utf-8'));
        
        // Creating the log of the recyclng bin
        const recycleBinLog = vscode.Uri.joinPath(workspace.recyclingBin, `.log`);
        await vscode.workspace.fs.writeFile(recycleBinLog, Buff.from('[]', 'utf-8'));

        // Create .vscode folder and the settings.json to specify word wrap being on
        const settings = {
            // eslint-disable-next-line @typescript-eslint/naming-convention

            // Turn on word wrap, and remove "'" and "-" from default word separators
            "editor.wordWrap": "on",
            "editor.wordSeparators": "`~!@#$%^&*()=+[{]}\\|;:\",.<>/?",
        };
        const settingsJSON = JSON.stringify(settings);


        const dotVscodeUri = vscode.Uri.joinPath(extension.rootPath, `.vscode`);
        await vscode.workspace.fs.createDirectory(dotVscodeUri);
        const settingsUri = vscode.Uri.joinPath(extension.rootPath, `.vscode/settings.json`);
        await vscode.workspace.fs.writeFile(settingsUri, Buff.from(settingsJSON, 'utf-8'));
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error creating directory: ${e}`);
        throw e;
    }

    // Finally, init the git repo
    try {
        await gitiniter();
    }
    catch(e) {
        vscode.window.showErrorMessage(`Unable to initialize git repo . . . \nMaybe create it yourself?`);
        throw e;
    }

    await vscode.window.showInformationMessage(`Successfully initialized the workspace.`);
    await vscode.commands.executeCommand('setContext', 'wt.valid', true);
    await vscode.commands.executeCommand('wt.walkthroughs.openIntro');
    return workspace;
}

// Function for loading an existing workspace from the root path of the user's vscode workspace
// If there is no existing workspace at the rootpath, then this function will return null
export async function loadWorkspace (context: vscode.ExtensionContext): Promise<Workspace | null> {

    // Check if the workspace is initialized already
    let valid = false;

    
    // If anything in the try block, then valid will remain false
    const workspace = new Workspace(context);
    try {
        // Try to read the /.wtconfig file
        const wtConfigUri = workspace.dotWtconfigPath;
        const wtconfigJSON = await vscode.workspace.fs.readFile(wtConfigUri);
        const wtconfig = JSON.parse(extension.decoder.decode(wtconfigJSON));

        // Read config info
        const config: Config = {
            createDate: wtconfig['createDate'] ?? -1,
            creator: wtconfig['creator'] ?? '',
            title: wtconfig['title'] ?? '',
        };
        workspace.config = config;

        // Check for the existence of all the necessary folders
        const folderStats: vscode.FileStat[] = await Promise.all(workspace.getFolders().map((folder) => {
            return vscode.workspace.fs.stat(folder);
        }));
        valid = folderStats.every(({ type }) => type === vscode.FileType.Directory);

        try {
            await loadWorkspaceContext(context, workspace.contextValuesFilePath, true);
        }
        catch (e) {
            console.log(`${e}`);
        }
    }
    catch (e) {
        console.log(`${e}`);
    }

    
    // Set the value of the context item wt.valid to the result of the validation process 
    vscode.commands.executeCommand('setContext', 'wt.valid', valid);
    
    if (!valid) {
        return null;
    }
    else {
        // Only after we know that that the workspace is valid should we register
        //      commands for that workspace
        workspace.registerCommands(context);
        return workspace;
    }
}

export async function loadWorkspaceContext (context: vscode.ExtensionContext, contextLocation: vscode.Uri, del: boolean = false) {

    // Attempt to read context values from the context values file on disk
    // Context values file may not exist, so allow a crash to happen
    const contextValuesBuffer = await vscode.workspace.fs.readFile(contextLocation);
    const contextValuesJSON = extension.decoder.decode(contextValuesBuffer);
    const contextValues: { [index: string]: any } = JSON.parse(contextValuesJSON);
    await Promise.all(Object.entries(contextValues).map(([ contextKey, contextValue ]) => {
        return [
            vscode.commands.executeCommand('setContext', contextKey, contextValue),
            context.workspaceState.update(contextKey, contextValue),
        ];
    }).flat());
    
    context.workspaceState.update('wt.todo.enabled', contextValues['wt.todo.enabled']);
    context.workspaceState.update('wt.wordWatcher.enabled', contextValues['wt.wordWatcher.enabled']);
    context.workspaceState.update('wt.proximity.enabled', contextValues['wt.proximity.enabled']);
    
    if (del) {
        // Then make sure to delete the workspace file when finished
        vscode.workspace.fs.delete(contextLocation);
    }
}