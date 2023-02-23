import * as vscode from 'vscode';
import * as console from '../vsconsole';
import * as fs from 'fs';
import { prompt } from '../help';
import * as vsconsole from '../vsconsole';
import * as extension from '../extension';
import { gitiniter } from '../gitTransactions';
import { OutlineView } from '../panels/treeViews/outline/outlineView';


export type Config = {
    createDate: number;
    creator: string;
    title: string;
};

export class Workspace {
    // Basic configuration information about the workspace
    config: Config = {
        createDate: Date.now(),
        creator: "No one",
        title: "Nothing"
    };

    public proximityEnabled?: boolean;
    public wordWatcherEnabled?: boolean;
    public todosEnabled?: boolean;

    // Path to the .wtconfig file that supplies the above `Config` information for the workspace
    public dotWtconfigPath: string;

    // Path to all the necessary folders for a workspace to function
    public chaptersFolder: string;
    public workSnipsFolder: string;
    public importFolder: string;
    public exportFolder: string;
    public recyclingBin: string;
    public contextValuesFilePath: string;

    // Returns a list of all 
    getFolders() {
        return [
            this.chaptersFolder, 
            this.workSnipsFolder, 
            this.importFolder, 
            this.exportFolder,
            this.recyclingBin,
        ];
    }

    // List of allowed import file types
    public importFileTypes: string[] = [
        'pdf',
        'wt',
        'txt',
        'docx',
        'html'
    ];

    // List of allowed export file types
    public exportFileTypes: string[] = [
        'pdf',
        'wt',
        'txt',
        'docx',
        'html'
    ];

    // List of non-allowed characters in exported file names
    public illegalCharacters: string[] = [
        '#',
        '%',
        '&',
        '{',
        '}',
        '\\',
        '<',
        '>',
        '*',
        '?',
        '/',
        ' ',
        '$',
        '!',
        '\'',
        '"',
        ':',
        '@',
        '+',
        '`',
        '|',
        '=',
        '.'
    ];

    // Simply initializes all the paths of necessary 
    constructor() {
        this.dotWtconfigPath = `${extension.rootPath}/.wtconfig`;
        this.chaptersFolder = `${extension.rootPath}/data/chapters`;
        this.workSnipsFolder = `${extension.rootPath}/data/snips`;
        this.importFolder = `${extension.rootPath}/data/import`;
        this.exportFolder = `${extension.rootPath}/data/export`;
        this.recyclingBin = `${extension.rootPath}/data/recycling`;
        this.contextValuesFilePath = `${extension.rootPath}/data/contextValues.json`
    }
}

// Function for creating a new workspace in the root path of the user's vscode workspace
export async function createWorkspace (
    context: vscode.ExtensionContext,
    defaultConfig?: Config
): Promise<Workspace> {

    const workspace = new Workspace();

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
        await fs.promises.writeFile(workspace.dotWtconfigPath, configJSON);

        // Create the data container
        await fs.promises.mkdir(`${extension.rootPath}/data`);

        // Create necessary folders
        for (const folder of workspace.getFolders()) {
            await fs.promises.mkdir(folder);
        }

        // Create the .config files for chapters and snips
        const chaptersDotConfig = `${workspace.chaptersFolder}/.config`;
        const snipsDotConfig = `${workspace.workSnipsFolder}/.config`;
        await fs.promises.writeFile(chaptersDotConfig, '{}');
        await fs.promises.writeFile(snipsDotConfig, '{}');
        
        // Creating the log of the recyclng bin
        const recycleBinLog = `${workspace.recyclingBin}/.log`;
        await fs.promises.writeFile(recycleBinLog, '[]');

        // Create .vscode folder and the settings.json to specify word wrap being on
        const settings = {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            "editor.wordWrap": "on"
        };
        const settingsJSON = JSON.stringify(settings);
        await fs.promises.mkdir(`${extension.rootPath}/.vscode`);
        await fs.promises.writeFile(`${extension.rootPath}/.vscode/settings.json`, settingsJSON);
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
    vscode.commands.executeCommand('setContext', 'wt.valid', true);
    return workspace;
}

// Function for loading an existing workspace from the root path of the user's vscode workspace
// If there is no existing workspace at the rootpath, then this function will return null
export async function loadWorkspace (context: vscode.ExtensionContext): Promise<Workspace | null> {
    // Check if the workspace is initialized already
    let valid = false;

    const workspace = new Workspace();
    
    // If anything in the try block, then valid will remain false
    try {
        // Try to read the /.wtconfig file
        const wtconfigJSON = await fs.promises.readFile(workspace.dotWtconfigPath);
        const wtconfig = JSON.parse(wtconfigJSON.toString());

        // Read config info
        const config: Config = {
            createDate: wtconfig['createDate'] ?? -1,
            creator: wtconfig['creator'] ?? '',
            title: wtconfig['title'] ?? '',
        };
        workspace.config = config;

        // Check for the existence of all the necessary folders
        const anyFoldersInvalid = workspace.getFolders().map((folder) => {
            const folderStat = fs.statSync(folder);
            return folderStat.isDirectory();
        })
        .find(isDir => !isDir);
        valid = !anyFoldersInvalid;

        try {
            // Attempt to read context values from the context values file on disk
            // Context values file may not exist, so allow a crash to happen
            const contextValuesBuffer: Buffer = await fs.promises.readFile(workspace.contextValuesFilePath);
            const contextValuesJSON = contextValuesBuffer.toString();
            const contextValues: { [index: string]: any } = JSON.parse(contextValuesJSON);
            await Promise.all(Object.entries(contextValues).map(([ contextKey, contextValue ]) => {
                return vscode.commands.executeCommand('setContext', contextKey, contextValue);
            }));

            // Store enabled variables
            workspace.todosEnabled = contextValues['wt.todo.enabled'];
            workspace.wordWatcherEnabled = contextValues['wt.wordWatcher.enabled'];
            workspace.proximityEnabled = contextValues['wt.proximity.enabled'];
        }
        catch (e) {}
    }
    catch (e) {
        let message: string | undefined = undefined;
        if (typeof e === 'string') {
            message = e;
        }
        else if (e instanceof Error) {
            message = e.message;
        }
        if (message) {
            vsconsole.log(message);
        }
    }

    // Set the value of the context item wt.valid to the result of the validation process 
    vscode.commands.executeCommand('setContext', 'wt.valid', valid);
    
    if (!valid) {
        return null;
    }
    else {
        return workspace;
    }
}
