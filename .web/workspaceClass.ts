import * as vscode from 'vscode';
import * as console from '../miscTools/vsconsole';
import { statFile } from '../miscTools/help';
import * as vsconsole from '../miscTools/vsconsole';
import * as extension from '../extension';
import { Config, loadWorkspaceContext, PositionInfo, SavedTabState, TabPositions } from './workspace';
import { Buff } from './../Buffer/bufferSource';
import { ReloadWatcher } from '../miscTools/reloadWatcher';
import { SynonymsProvider } from '../intellisense/synonymsProvider/provideSynonyms';
import { Autocorrect } from '../autocorrect/autocorrect';
import { SearchBarView } from '../search/searchBarView';

export type DiskContextType = {
    "wt.outline.collapseState": {
        [index: string]: boolean,
    },
    "wt.synonyms.synonyms": string[],
    "wt.notebook.tree.enabled": boolean,
    "wt.notebook.dontAskDeleteNote": boolean,
    "wt.notebook.dontAskDeleteDescription": boolean,
    "wt.notebook.dontAskDeleteAppearance": boolean,
    "wt.todo.enabled": boolean,
    "wt.todo.collapseState": {
        [index: string]: boolean;
    },
    "wt.wordWatcher.enabled": boolean,
    "wt.wordWatcher.watchedWords": string[],
    "wt.wordWatcher.disabledWatchedWords": string[],
    "wt.wordWatcher.excludedWords": string[],
    "wt.wordWatcher.rgbaColors": {
        [index: string]: string;
    },
    "wt.spellcheck.enabled": boolean,
    "wt.very.enabled": boolean,
    "wt.colors.enabled": boolean,
    "wt.textStyle.enabled": boolean,
    "wt.fileAccesses.positions": {
        [index: string]: Omit<PositionInfo, 'active'>
    },
    "wt.personalDictionary": {
        [index: string]: 1
    },
    "wt.colors.extraColors": {
        [index: string]: {
            [index: string]: 1
        }
    },
    "wt.wh.synonyms": string[],
    "wt.reloadWatcher.enabled": boolean,
    "wt.reloadWatcher.openedTabs": TabPositions,
    "wt.tabStates.savedTabStates": SavedTabState,
    "wt.tabStates.latestTabState": string,
    "wt.autocorrections.enabled": Autocorrect["enabled"];
    "wt.autocorrections.corrections": Autocorrect["corrections"];
    "wt.autocorrections.dontCorrect": Autocorrect["dontCorrect"];
    "wt.autocorrections.exclusions": Autocorrect["exclusions"];
    "wt.wtSearch.search.latestSearchBarValue": SearchBarView["latestSearchBarValue"];
    "wt.wtSearch.search.latestReplaceBarValue": SearchBarView["latestReplaceBarValue"];
    "wt.wtSearch.search.wholeWord": SearchBarView["wholeWord"];
    "wt.wtSearch.search.regex": SearchBarView["regex"];
    "wt.wtSearch.search.caseInsensitive": SearchBarView["caseInsensitive"];
    "wt.wtSearch.search.matchTitles": SearchBarView["matchTitles"];
}

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
    public exportFolder: vscode.Uri;
    public recyclingBin: vscode.Uri;
    public contextValuesFilePath: vscode.Uri;
    public notebookPath: vscode.Uri;
    public notebookFolder: vscode.Uri;
    public scratchPadFolder: vscode.Uri;

    // Old folders
    public workBibleFolder: vscode.Uri;

    public synonymsCachePath: vscode.Uri;

    // Returns a list of all 
    getFolders() {
        return [
            this.chaptersFolder, 
            this.workSnipsFolder, 
            this.exportFolder,
            this.recyclingBin,
            this.notebookFolder,
            this.scratchPadFolder
        ];
    }

    // List of allowed import file types
    public importFileTypes: string[] = [
        'wt',
        'txt',
        'docx',
        'html',
        'odt',
        'md'
    ];

    // List of allowed export file types
    public exportFileTypes: string[] = [
        'wt',
        'txt',
        'docx',
        'html',
        'odt',
        'md'
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

    static lastWriteTimestamp: number | null = null;
    static async packageContextItems (useDefaultFS: boolean = false) {
        const contextUri = extension.ExtensionGlobals.workspace.contextValuesFilePath;

        // 
        const contextFileStat = await statFile(contextUri);
        if (!contextFileStat || Workspace.lastWriteTimestamp === null || contextFileStat.mtime > Workspace.lastWriteTimestamp) {
            return;
        }

        // If the last write was less than 20 seconds ago, don't bother writing again
        const twentySecondsAgo = Date.now() - (20 * 1000);
        if (this.lastWriteTimestamp && this.lastWriteTimestamp >= twentySecondsAgo) {
            return;
        }

        const saveCache = SynonymsProvider.writeCacheToDisk(false);
        // Write context items to the file system before git save
        const contextItems: DiskContextType = await vscode.commands.executeCommand('wt.getPackageableItems');
        const contextJSON = JSON.stringify(contextItems, undefined, 2);

        ReloadWatcher.disableReloadWatch();
        await vscode.workspace.fs.writeFile(contextUri, Buff.from(contextJSON, 'utf-8'));

        setTimeout(() => {
            ReloadWatcher.enableReloadWatch();
            this.lastWriteTimestamp = Date.now();
        }, 1000);

        return saveCache;
    }

    static async replaceContextValuesOnDisk(contextValues: DiskContextType) {
        ReloadWatcher.disableReloadWatch();
        await vscode.workspace.fs.writeFile(
            extension.ExtensionGlobals.workspace.contextValuesFilePath, 
            Buff.from(JSON.stringify(contextValues), 'utf-8')
        );
        setTimeout(ReloadWatcher.enableReloadWatch, 1000);
    }

    static async forcePackaging (): Promise<void>;
    static async forcePackaging <K extends keyof DiskContextType> (context: vscode.ExtensionContext, key: K, value: DiskContextType[K]): Promise<void>;

    static async forcePackaging <K extends keyof DiskContextType> (context?: vscode.ExtensionContext, key?: K, value?: DiskContextType[K]) {
        if (context && key && value) {
            await context.globalState.update(key, value);
        }
        const contextUri = extension.ExtensionGlobals.workspace.contextValuesFilePath;
        const contextItems: DiskContextType = await vscode.commands.executeCommand('wt.getPackageableItems');
        const contextJSON = JSON.stringify(contextItems, undefined, 2);
        ReloadWatcher.disableReloadWatch();
        return vscode.workspace.fs.writeFile(contextUri, Buff.from(contextJSON, 'utf-8'));
    }

    static async updateContext <K extends keyof DiskContextType> (context: vscode.ExtensionContext, key: K, value: DiskContextType[K], options?: { isSetting: boolean }) {
        await context.globalState.update(key, value);
        if (options?.isSetting) {
            const configuration = vscode.workspace.getConfiguration();
            await configuration.update(key, value, vscode.ConfigurationTarget.Workspace);
        }
        return Workspace.packageContextItems();
    }

    
    // Simply initializes all the paths of necessary 
    constructor(context: vscode.ExtensionContext) {
        this.dotWtconfigPath = vscode.Uri.joinPath(extension.rootPath, `.wtconfig`);
        this.chaptersFolder = vscode.Uri.joinPath(extension.rootPath, `data/chapters`);
        this.workSnipsFolder = vscode.Uri.joinPath(extension.rootPath, `data/snips`);
        this.exportFolder = vscode.Uri.joinPath(extension.rootPath, `data/export`);
        this.recyclingBin = vscode.Uri.joinPath(extension.rootPath, `data/recycling`);
        this.contextValuesFilePath = vscode.Uri.joinPath(extension.rootPath, `data/contextValues.json`);
        this.notebookFolder = vscode.Uri.joinPath(extension.rootPath, `data/notebook`);
        this.scratchPadFolder = vscode.Uri.joinPath(extension.rootPath, `data/scratchPad`);
        this.synonymsCachePath = vscode.Uri.joinPath(extension.rootPath, 'synonymsCache.json');
        
        // Old folders
        this.notebookPath = vscode.Uri.joinPath(extension.rootPath, 'data/worldNotebook.json');
        this.workBibleFolder = vscode.Uri.joinPath(extension.rootPath, `data/workBible`);
    }

    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(vscode.commands.registerCommand('wt.workspace.loadContextValues', async () => {
            
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
        }));

        context.subscriptions.push(vscode.commands.registerCommand('wt.workspace.generateContextValues', async () => {
            try {
                await Workspace.packageContextItems();
            }
            catch (err: any) {
                vscode.window.showErrorMessage(`ERROR: An error occurred while generating context items: ${err.message}: ${JSON.stringify(err, null, 2)}`);
                return;
            }
            vscode.window.showInformationMessage(`INFO: Successfully created context values file at: '${this.contextValuesFilePath}'`);
        }));
    }
}