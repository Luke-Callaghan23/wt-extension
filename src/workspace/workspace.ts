import * as vscode from 'vscode';
import * as console from '../miscTools/vsconsole';
import { defaultProgress, getSectionedProgressReporter, prompt, statFile } from '../miscTools/help';
import * as vsconsole from '../miscTools/vsconsole';
import * as extension from '../extension';
import { gitiniter } from '../gitTransactions';
import { Buff } from '../Buffer/bufferSource';
import { DiskContextType, Workspace } from './workspaceClass';
import { Autocorrect } from '../autocorrect/autocorrect';
import { wbToNb } from '../miscTools/workBibleToNotebook';


export type Config = {
    createDate: number;
    creator: string;
    title: string;
};

// Function for creating a new workspace in the root path of the user's vscode workspace
export async function createWorkspace (
    context: vscode.ExtensionContext,
    defaultConfig?: Config
): Promise<Workspace | null> {

    const workspace = new Workspace(context);

    if (!defaultConfig) {
        // Prompt the user for their name
        let creatorName = await prompt({
            placeholder: Math.random() <= 0.3333 ? 'John Doe' : Math.random() > 0.50 ? 'Jane Doe' : 'Them Doe',
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

        try {
            await vscode.workspace.fs.writeFile(wtConfigUri, Buff.from(configJSON, 'utf-8'));
        }
        catch (err: any) {
            vscode.window.showErrorMessage(`[ERROR] Error creating the workspace.  Please make sure VSCode has permissions to write files to your file system.  If you are using the web extension (wtaniwe-web), then please make sure you've opened a folder (either on disk or a remote location), before running "Create Workspace"`)
            return null;
        }

        // Create the data container
        const dataUri = vscode.Uri.joinPath(extension.rootPath, `data`);
        await vscode.workspace.fs.createDirectory(dataUri);

        const contextValuesJsonUri = vscode.Uri.joinPath(extension.rootPath, 'data', 'contextValues.json');
        await vscode.workspace.fs.writeFile(contextValuesJsonUri, extension.encoder.encode(JSON.stringify({
            "wt.colors.enabled": true,
            "wt.colors.extraColors": {},
            "wt.fileAccesses.positions": {},
            "wt.outline.collapseState": {},
            "wt.personalDictionary": {},
            "wt.reloadWatcher.openedTabs": {},
            "wt.spellcheck.enabled": true,
            "wt.synonyms.synonyms": [],
            "wt.textStyle.enabled": true,
            "wt.todo.collapseState": {},
            "wt.todo.enabled": true,
            "wt.very.enabled": true, 
            "wt.wh.synonyms": [],
            "wt.wordWatcher.disabledWatchedWords": [],
            "wt.wordWatcher.enabled": true,
            "wt.wordWatcher.rgbaColors": {},
            "wt.wordWatcher.unwatchedWords": [],
            "wt.wordWatcher.watchedWords": [],
            "wt.notebook.dontAskDeleteAppearance": false,
            "wt.notebook.dontAskDeleteDescription": false,
            "wt.notebook.dontAskDeleteNote": false,
            "wt.notebook.tree.enabled": false,
        }, undefined, 2)));

        const gitignoreUri = vscode.Uri.joinPath(extension.rootPath, '.gitignore');
        await vscode.workspace.fs.writeFile(gitignoreUri, Buff.from(`
tmp/
tmp/**
**/synonymsCache.json
`));

        // Create necessary folders
        for (const folder of workspace.getFolders()) {
            await vscode.workspace.fs.createDirectory(folder);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, '.gitkeep'), new Uint8Array());
        }

        // Create the .config files for chapters, snips, and scratchPad
        const chaptersDotConfig = vscode.Uri.joinPath(workspace.chaptersFolder, `.config`);
        const snipsDotConfig = vscode.Uri.joinPath(workspace.workSnipsFolder, `.config`);
        const scratchPadConfig = vscode.Uri.joinPath(workspace.scratchPadFolder, `.config`);
        await vscode.workspace.fs.writeFile(chaptersDotConfig, Buff.from('{}', 'utf-8'));
        await vscode.workspace.fs.writeFile(snipsDotConfig, Buff.from('{}', 'utf-8'));
        await vscode.workspace.fs.writeFile(scratchPadConfig, Buff.from('{}', 'utf-8'));
        
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
        await vscode.workspace.fs.createDirectory(workspace.notebookFolder);
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

    vscode.window.showInformationMessage(`Successfully initialized the workspace.`);
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
        let attempting: vscode.Uri | undefined;
        try {
            const folderStats: vscode.FileStat[] = [];
            for (const folder of workspace.getFolders()) {
                attempting = folder;
                folderStats.push(await vscode.workspace.fs.stat(folder));
            }
            valid = folderStats.every(({ type }) => type === vscode.FileType.Directory);

            try {
                await loadWorkspaceContext(context, workspace.contextValuesFilePath, true);
            }
            catch (e) {
                console.log(`${e}`);
                vscode.window.showWarningMessage(`Coult not load WT environment because \`loadWorkspaceContext\` failed with the following error: ${e}`);
            }
        }
        catch (err: any) {
            if (attempting?.fsPath === workspace.notebookFolder.fsPath) {
                // Notebook folder has moved from original folder called 'workBible'
                // Older WT envs will need to adjust to this new folder name
                if (await statFile(workspace.workBibleFolder)) {
                    const result = await vscode.window.showInformationMessage("Work Bible has moved!!!", {
                        modal: true,
                        detail: "The work bible has been renamed to Notebook.  As a part of other improvements, we're going to need to rename your local folder 'workBible' to 'notebook' and convert the notes to a new format.  Please enter 'confirm' to rename this folder, or 'cancel' to create a new empty 'notebook' folder (No clue why you would want that, but whatever)."
                    }, "Confirm");

                    if (result === "Confirm") {
                        await defaultProgress("Converting Notes", async (progress) => {
                            const report = getSectionedProgressReporter([
                                "Created 'notebook' folder!",
                                "Converted to new notes format!",
                                "Delted old 'workBible folder",
                            ], progress, 1);
                            await vscode.workspace.fs.createDirectory(workspace.notebookFolder);
                            report("Created 'notebook' folder!");
                            await wbToNb(workspace.workBibleFolder, workspace.notebookFolder);
                            report("Converted to new notes format!");
                            await vscode.workspace.fs.delete(workspace.workBibleFolder, {
                                recursive: true
                            });
                            report("Delted old 'workBible folder");
                        })
                    }
                    else {
                        await vscode.workspace.fs.createDirectory(workspace.notebookFolder);
                        vscode.window.showInformationMessage("Created 'notebook' folder!");
                    } 
                    return loadWorkspace(context);
                }
            }
            vscode.window.showWarningMessage(`Could not load WT environment because folder '${attempting}' was missing`);
            return null;
        }

    }
    catch (e) {
        console.log(`${e}`);
        vscode.window.showWarningMessage(`Coult not load WT environment because the following error occurred: ${e}`);
    }
    
    // Set the value of the context item wt.valid to the result of the validation process 
    await vscode.commands.executeCommand('setContext', 'wt.valid', valid);
    await vscode.commands.executeCommand('setContext', 'wt.loaded', true);
    
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

export type PositionInfo = {
    anchorLine: number,
    anchorChar: number,
    activeLine: number,
    activeChar: number,
    active: boolean,
};

export type VscodeViewCol = string;
export type RelativeUri = string;
export type TabPositions = { 
    [index: VscodeViewCol]: {
        [index: RelativeUri]: PositionInfo
    } 
};

export type SavedTabStateName = string;
export type SavedTabState = {
    [index: SavedTabStateName]: {
        positions: TabPositions,
        created: number,
    }
};

export async function loadWorkspaceContext (
    context: vscode.ExtensionContext, 
    contextLocation: vscode.Uri, 
    del: boolean = false
): Promise<DiskContextType> {

    // Attempt to read context values from the context values file on disk
    // Context values file may not exist, so allow a crash to happen
    const contextValuesBuffer = await vscode.workspace.fs.readFile(contextLocation);
    const contextValuesJSON = extension.decoder.decode(contextValuesBuffer);
    const contextValues: DiskContextType = JSON.parse(contextValuesJSON);
    await Promise.all(Object.entries(contextValues).map(([ contextKey, contextValue ]) => {
        return [
            vscode.commands.executeCommand('setContext', contextKey, contextValue),
            context.workspaceState.update(contextKey, contextValue),
        ];
    }).flat());
    Workspace.lastWriteTimestamp = Date.now();
    return contextValues;
}