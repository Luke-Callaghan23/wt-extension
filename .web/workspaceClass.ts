import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { prompt } from '../help';
import * as vsconsole from '../vsconsole';
import * as extension from '../extension';
import { gitiniter } from '../gitTransactions';
import { Config, loadWorkspaceContext } from './workspace';
import { Buff } from './../Buffer/bufferSource';



export class Workspace {
    // Basic configuration information about the workspace
    config: Config = {
        createDate: Date.now(),
        creator: "No one",
        title: "Nothing"
    };

    // Path to the .wtconfig file that supplies the above `Config` information for the workspace
    public dotWtconfigPath: vscode.Uri;

    // Path to all the necessary folders for a workspace to function
    public chaptersFolder: vscode.Uri;
    public workSnipsFolder: vscode.Uri;
    public recyclingBin: vscode.Uri;
    public contextValuesFilePath: vscode.Uri;

    // Returns a list of all 
    getFolders() {
        return [
            this.chaptersFolder, 
            this.workSnipsFolder, 
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


    static async packageContextItems () {
        // Write context items to the file system before git save
        const contextItems: { [index: string]: any } = await vscode.commands.executeCommand('wt.getPackageableItems');
        const contextJSON = JSON.stringify(contextItems);
        const contextUri = vscode.Uri.joinPath(extension.rootPath, `data/contextValues.json`);
        return vscode.workspace.fs.writeFile(contextUri, Buff.from(contextJSON, 'utf-8'));
    }
    
    // Simply initializes all the paths of necessary 
    constructor(context: vscode.ExtensionContext) {
        this.dotWtconfigPath = vscode.Uri.joinPath(extension.rootPath, `.wtconfig`);
        this.chaptersFolder = vscode.Uri.joinPath(extension.rootPath, `data/chapters`);
        this.workSnipsFolder = vscode.Uri.joinPath(extension.rootPath, `data/snips`);
        this.recyclingBin = vscode.Uri.joinPath(extension.rootPath, `data/recycling`);
        this.contextValuesFilePath = vscode.Uri.joinPath(extension.rootPath, `data/contextValues.json`);
    
        this.registerCommands(context);
    }

    registerCommands(context: vscode.ExtensionContext): void {
        vscode.commands.registerCommand('wt.workspace.loadContextValues', async () => {
            
            const action = "Load Context";
            const selectedAction = await vscode.window.showQuickPick(
                [ action, "Cancel" ],
                {
                    title: `Caution: this will cause a reload of the Visual Studio Code window.  This will cause action histories such as 'Undo' (ctrl+z) and 'Redo' (ctrl+y) to be reset!  Proceed?`,
                    canPickMany: false,
                    placeHolder: action,
                }
            );
            if (!selectedAction || selectedAction === 'Cancel') return;

            // Request the location of the new context values
            const newContextTmp = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: this.contextValuesFilePath,
                filters: {
                    'Context Value File': [ 'json' ]
                },
                openLabel: 'Load',
                title: 'Select a file for loading context items from',
            });
            const newContext = !newContextTmp ? this.contextValuesFilePath : newContextTmp[0];

            try {
                // Load the context values into this workspace
                await loadWorkspaceContext(context, newContext);
            }
            catch (err: any) {
                vscode.window.showErrorMessage(`ERROR: Error occurred while loading context values from '${newContext}': ${err.message}`);
                return;
            }

            // Save the new context
            await vscode.workspace.fs.copy(newContext, this.contextValuesFilePath);
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        });

        vscode.commands.registerCommand('wt.workspace.generateContextValues', async () => {
            try {
                await Workspace.packageContextItems();
            }
            catch (err: any) {
                vscode.window.showErrorMessage(`ERROR: An error occurred while generating context items: ${err.message}: ${JSON.stringify(err, null, 2)}`);
                return;
            }
            vscode.window.showInformationMessage(`INFO: Successfully created context values file at: '${this.contextValuesFilePath}'`);
        });
    }
}