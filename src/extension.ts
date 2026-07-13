'use strict';

import * as vscode from 'vscode';
// import * as console from './vsconsole';
import { ImportFileSystemView } from './import/importFileSystemView';
import { WHViewProvider } from './whWebview/whWebview';
import { CoderModer } from './codeMode/codeMode';
import { activateSpeak } from './ttsDebugger/tts/tts';
import { activateDebug } from './ttsDebugger/debugger/debugExtention';
import { ExportForm } from './export/exportFormView';
import { importWorkspace as importWorkspaceFromIWEFile } from './workspace/importExport/importWorkspace';

import { OutlineView } from './outline/outlineView';
import { TODOsView } from './TODO/TODOsView';
import { WordWatcher } from './wordWatcher/wordWatcher';
import { Toolbar } from './editor/toolbar';

import { SynonymViewProvider } from './synonymsWebview/synonymsView';
import { DiskContextType, Workspace } from './workspace/workspaceClass';
import { loadWorkspace, createWorkspace } from './workspace/workspace';
import { FileAccessManager } from './miscTools/fileAccesses';
import { Packageable, packageForExport } from './packageable';
import { TimedView } from './timedView';
import { Proximity } from './proximity/proximity';
import { PersonalDictionary } from './intellisense/spellcheck/personalDictionary';
import { SynonymsIntellisense as Intellisense } from './intellisense/intellisense';
import { Spellcheck } from './intellisense/spellcheck/spellcheck';
import { ColorIntellisense } from './intellisense/colors/colorIntellisense';
import { ColorGroups } from './intellisense/colors/colorGroups';
import { RecyclingBinView } from './recyclingBin/recyclingBinView';
import { VeryIntellisense } from './intellisense/very/veryIntellisense';
import { WordCount } from './wordCounts/wordCount';
import { TextStyles } from './textStyles/textStyles';
import { NotebookPanel } from './notebook/notebookPanel';
import { StatusBarTimer } from './statusBarTimer/statusBarTimer';
import { TabLabels } from './tabLabels/tabLabels';
import { searchFiles } from './miscTools/searchFiles';
import { ReloadWatcher } from './miscTools/reloadWatcher';
import { convertFileNames } from './miscTools/convertFileNames';
import { ScratchPadView } from './scratchPad/scratchPadView';
import { TabStates } from './miscTools/tabStates';
import { Autocorrect } from './autocorrect/autocorrect';
import { FileLinker } from './miscTools/fileLinker';
import { SearchResultsView } from './search/searchResultsView';
import { SearchBarView } from './search/searchBarView';
import { FragmentOverviewView } from './fragmentOverview/fragmentOverview';
import { DocumentLinker } from './miscTools/documentLinker';
import { defaultProgress, getSectionedProgressReporter, progressOnViews, statFile } from './miscTools/help';
import { WTNotebookSerializer } from './notebook/notebookApi/notebookSerializer';
import { WTNotebookController } from './notebook/notebookApi/notebookController';
import * as console from './miscTools/vsconsole';
import { SpacingHighlights } from './miscTools/spacingHighlights';
import { NotebookWebview } from './notebook/notebookWebview';
import { DefinitionsPanelWebview } from './intellisense/synonymsProvider/definitionPanel';
import { getRipGrepBinarySearchPromise, RipGrep } from './miscTools/grepper/ripGrep';


export class Extension {

    public static rootPath: vscode.Uri;
    public static readonly decoder = new TextDecoder();
    public static readonly encoder = new TextEncoder();
    public static readonly wordSeparator: string = '(^|[\\.\\?\\:\\;,\\(\\)!\\&\\s\\+\\-\\n"\'^_*~]|$)';
    public static readonly wordSeparatorRegex = new RegExp(this.wordSeparator.split('|')[1], 'g');
    public static readonly sentenceSeparator: RegExp = /[.?!]/g;
    public static readonly paragraphSeparator: RegExp = /\n\n/g;

    public static readonly urlMainRegex = /(https?|ftp):\/\/[^\s\/$.?#].[^\s]*/ig;
    public static readonly urlRegex = new RegExp(`${this.wordSeparator}(?<link>${this.urlMainRegex.source})${this.wordSeparator}`, 'gi');

    private static _outlineView: OutlineView;
    private static _recyclingBinView: RecyclingBinView;
    private static _scratchPadView: ScratchPadView;
    private static _notebookPanel: NotebookPanel;
    private static _todoView: TODOsView;
    private static _timedViews: TimedView;
    private static _searchBarView: SearchBarView;
    private static _searchResultsView: SearchResultsView;
    private static _personalDictionary: PersonalDictionary;
    private static _intellisense: Intellisense;
    private static _wh: WHViewProvider;
    private static _wordWatcher: WordWatcher;
    private static _colorGroups: ColorGroups;
    private static _codeMode: CoderModer;
    private static _synonymsWebview: SynonymViewProvider;
    private static _importFileSystemView: ImportFileSystemView;
    private static _tabLabels: TabLabels;
    private static _tabStates: TabStates;
    private static _statusBarTimer: StatusBarTimer;
    private static _workspace: Workspace;
    private static _context: vscode.ExtensionContext;
    private static _packageableItems: Packageable<any>[];
    private static _notebookSerializer: WTNotebookSerializer;
    private static _notebookSerializerDispose: vscode.Disposable;

    static get outlineView () {
        if (!this._outlineView) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'outlineView' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'outlineView' before initialized.  Only access global data after it's been initialized.";
        }
        return this._outlineView;
    }
    static get recyclingBinView () {
        if (!this._recyclingBinView) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'recyclingBinView' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'recyclingBinView' before initialized.  Only access global data after it's been initialized.";
        }
        return this._recyclingBinView;
    }
    static get scratchPadView () {
        if (!this._scratchPadView) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'scratchPadView' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'scratchPadView' before initialized.  Only access global data after it's been initialized.";
        }
        return this._scratchPadView;
    }
    static get notebookPanel () {
        if (!this._notebookPanel) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'notebookPanel' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'notebookPanel' before initialized.  Only access global data after it's been initialized.";
        }
        return this._notebookPanel;
    }
    static get todoView () {
        if (!this._todoView) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'todoView' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'todoView' before initialized.  Only access global data after it's been initialized.";
        }
        return this._todoView;
    }
    static get timedViews () {
        if (!this._timedViews) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'timedViews' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'timedViews' before initialized.  Only access global data after it's been initialized.";
        }
        return this._timedViews;
    }
    static get searchBarView () {
        if (!this._searchBarView) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'searchBarView' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'searchBarView' before initialized.  Only access global data after it's been initialized.";
        }
        return this._searchBarView;
    }
    static get searchResultsView () {
        if (!this._searchResultsView) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'searchResultsView' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'searchResultsView' before initialized.  Only access global data after it's been initialized.";
        }
        return this._searchResultsView;
    }
    static get personalDictionary () {
        if (!this._personalDictionary) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'personalDictionary' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'personalDictionary' before initialized.  Only access global data after it's been initialized.";
        }
        return this._personalDictionary;
    }
    static get intellisense () {
        if (!this._intellisense) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'intellisense' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'intellisense' before initialized.  Only access global data after it's been initialized.";
        }
        return this._intellisense;
    }
    static get wh () {
        if (!this._wh) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'wh' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'wh' before initialized.  Only access global data after it's been initialized.";
        }
        return this._wh;
    }
    static get wordWatcher () {
        if (!this._wordWatcher) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'wordWatcher' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'wordWatcher' before initialized.  Only access global data after it's been initialized.";
        }
        return this._wordWatcher;
    }
    static get colorGroups () {
        if (!this._colorGroups) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'colorGroups' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'colorGroups' before initialized.  Only access global data after it's been initialized.";
        }
        return this._colorGroups;
    }
    static get codeMode () {
        if (!this._codeMode) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'codeMode' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'codeMode' before initialized.  Only access global data after it's been initialized.";
        }
        return this._codeMode;
    }
    static get synonymsWebview () {
        if (!this._synonymsWebview) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'synonymsWebview' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'synonymsWebview' before initialized.  Only access global data after it's been initialized.";
        }
        return this._synonymsWebview;
    }
    static get importFileSystemView () {
        if (!this._importFileSystemView) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'importFileSystemView' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'importFileSystemView' before initialized.  Only access global data after it's been initialized.";
        }
        return this._importFileSystemView;
    }
    static get tabLabels () {
        if (!this._tabLabels) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'tabLabels' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'tabLabels' before initialized.  Only access global data after it's been initialized.";
        }
        return this._tabLabels;
    }
    static get tabStates () {
        if (!this._tabStates) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'tabStates' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'tabStates' before initialized.  Only access global data after it's been initialized.";
        }
        return this._tabStates;
    }
    static get statusBarTimer () {
        if (!this._statusBarTimer) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'statusBarTimer' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'statusBarTimer' before initialized.  Only access global data after it's been initialized.";
        }
        return this._statusBarTimer;
    }
    static get workspace () {
        if (!this._workspace) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'workspace' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'workspace' before initialized.  Only access global data after it's been initialized.";
        }
        return this._workspace;
    }
    static get context () {
        if (!this._context) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'context' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'context' before initialized.  Only access global data after it's been initialized.";
        }
        return this._context;
    }
    static get packageableItems () {
        if (!this._packageableItems) {
            // Don't throw an error for this one
            // This can be called during startup and we don't want it crashing before `this._packageableItems` is initialized
            return [];
        }
        return this._packageableItems;
    }
    static get notebookSerializer () {
        if (!this._notebookSerializer) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'notebookSerializer' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'notebookSerializer' before initialized.  Only access global data after it's been initialized.";
        }
        return this._notebookSerializer;
    }
    static get notebookSerializerDispose () {
        if (!this._notebookSerializerDispose) {
            vscode.window.showErrorMessage("[ERROR] Attempted to access 'notebookSerializerDispose' before initialized.  Only access global data after it's been initialized.");
            throw "[ERROR] Attempted to access 'notebookSerializerDispose' before initialized.  Only access global data after it's been initialized.";
        }
        return this._notebookSerializerDispose;
    }

    public static async getPackageableItems (): Promise<DiskContextType> {
        return packageForExport(this.packageableItems);
    }

    public static async activateExtension (context: vscode.ExtensionContext) {
        this._notebookSerializer = new WTNotebookSerializer();
        this._notebookSerializerDispose = vscode.workspace.registerNotebookSerializer('wt.notebook', Extension.notebookSerializer)

        // Load the root path of file system where the extension was loaded
        console.log("Resetting root path");
        this.rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
            ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.parse('.');

        context.subscriptions.push(vscode.commands.registerCommand("wt.walkthroughs.openIntro", this.openIntro.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand("wt.walkthroughs.openImports", this.openImportsIntro.bind(this)));
        context.subscriptions.push(vscode.commands.registerCommand("wt.searchFiles", searchFiles));    
        context.subscriptions.push(vscode.commands.registerCommand('wt.convert', () => convertFileNames()));

        context.subscriptions.push(vscode.commands.registerCommand('wt.reload', async () => {
            console.log("Resetting root path");
            this.rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
                ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.parse('.');
            return this.loadExtensionWithProgress(context, "Reloading Integrated Writing Environment");
        }));

        const loadWorkspaceSuccess = await this.loadExtensionWithProgress(context, "Starting Integrated Writing Environment");
        if (loadWorkspaceSuccess) return;

        // If the attempt to load the workspace failed, then register commands both for loading 
        //        a workspace from a .iwe environment file or for creating a new iwe environment
        //        at the current location
        context.subscriptions.push(vscode.commands.registerCommand('wt.importWorkspace', () => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Importing Workspace"
            }, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
                try {
                    const workDivision = 0.5;
                    const ws = await importWorkspaceFromIWEFile(context, progress, workDivision);
                    if (!ws) return this.handleLoadFailure(`Could not import .iwe workspace: Make sure the .iwe file you provided is the exact same as the one created by this extension.`);

                    await this.loadExtensionWorkspace(context, ws, progress, workDivision);
                    return;
                }
                catch (err: any) {
                    return this.handleLoadFailure(err);
                }
            });
        }));
        context.subscriptions.push(vscode.commands.registerCommand('wt.createWorkspace', async () => {
            return vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Creating Workspace"
            }, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {

                console.log("Resetting root path");
                this.rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
                    ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.parse('.');

                try {
                    const workDivision = 0.5;
                    const ws = await createWorkspace(context);
                    if (!ws) return;
                    await this.loadExtensionWorkspace(context, ws, progress, workDivision);
                }
                catch(err: any) {
                    this.handleLoadFailure(err);
                    throw err;
                }
            });
        }));
    }

    public static openIntro () {
        return vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `luke-callaghan.wtaniwe#wt.introWalkthrough`, false);
    }

    public static openImportsIntro () {
        return vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `luke-callaghan.wtaniwe#wt.importsWalkthrough`, false);
    }

    private static async loadExtensionWithProgress (context: vscode.ExtensionContext, title: "Starting Integrated Writing Environment" | "Reloading Integrated Writing Environment"): Promise<boolean> {
        // Exit early with no errors if there is no data folder
        // Probably means the user just downloaded the extension and don't want to confuse them with the 'Missing file' error
        if (!(await statFile(vscode.Uri.joinPath(this.rootPath, 'data')))) {
            await vscode.commands.executeCommand('setContext', 'wt.valid', false);
            await vscode.commands.executeCommand('setContext', 'wt.loaded', true);
            vscode.window.showInformationMessage(`[INFO] Could not load WTANIWE workspace: no data folder at '${vscode.Uri.joinPath(this.rootPath, 'data')}'`);
            return false;
        }
        return defaultProgress(title, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
            const workspace = await loadWorkspace(context);
            progress.report({ message: "Loaded workspace" });
            if (workspace === null) return false;
            this._workspace = workspace;
        
            await this.loadExtensionWorkspace(context, workspace, progress, 1);
            progress.report({ message: "Loaded extension" });
            return true;
        });
    }
    
    // To be called whenever a workspace is successfully loaded
    // Loads all the content for all the views for the wt extension
    private static async loadExtensionWorkspace (
        context: vscode.ExtensionContext, 
        workspace: Workspace,
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        workDivision: number = -1,
    ): Promise<void> {
        try {
            const report = progress ? getSectionedProgressReporter ([
                "Loaded outline",
                "Loaded TODO tree",
                "Loaded recycling bin",
                "Loaded spellchecker",
                "Loaded intellisense",
                "Loaded scratch pad",
                "Loaded fragment overview",
                "Loaded tab groups",
                "Loaded search bad",
                "Loaded notebook",
                "Loaded status bar items",
                "Loaded tab labels",
                "Loaded text-to-speech debugger",
                "Finished.",
            ] as const, progress, workDivision)
            : (report: string) => {
                console.log(report)
            };
            this._workspace = workspace;
            this._context = context;

            this._outlineView = new OutlineView(context, workspace);                // wt.outline
            await this._outlineView.init();
            report("Loaded outline");

            this._todoView = new TODOsView(context, workspace);                        // wt.todo
            await this.todoView.init();
            report("Loaded TODO tree");
            
            this._personalDictionary = new PersonalDictionary(context, workspace);
            const autocorrection = new Autocorrect(context, workspace);
            const spellcheck = new Spellcheck(context, workspace, this.personalDictionary, autocorrection);
            report("Loaded spellchecker");

            this._intellisense = new Intellisense(context, workspace, this.personalDictionary, true);
            await this.intellisense.init();
            const veryIntellisense = new VeryIntellisense(context, workspace);
            this._colorGroups = new ColorGroups(context);
            const colorIntellisense = new ColorIntellisense(context, workspace, this.colorGroups);
            const spacingHighlights = new SpacingHighlights();
            const definitionsPanel = new DefinitionsPanelWebview(context, workspace);
            report("Loaded intellisense");

            this._importFileSystemView = new ImportFileSystemView(context, workspace);        // wt.import.fileSystem
            this._synonymsWebview = new SynonymViewProvider(context, workspace);        // wt.synonyms
            this._wh = new WHViewProvider(context, workspace);        // wt.synonyms
            
            this._wordWatcher = new WordWatcher(context, workspace);            // wt.wordWatcher
            const proximity = new Proximity(context, workspace);
            const textStyles = new TextStyles(context, workspace);    
            this._recyclingBinView = new RecyclingBinView(context, workspace);        
            await this.recyclingBinView.initialize();
            report("Loaded recycling bin");

            const reloadWatcher = new ReloadWatcher(workspace, context);
            this._scratchPadView = new ScratchPadView(context, workspace);
            await this.scratchPadView.init();
            report("Loaded scratch pad");

            const fragmentOverview = new FragmentOverviewView(context, workspace);
            report("Loaded fragment overview");

            this._tabStates = new TabStates(context, workspace);
            report("Loaded tab groups");

            const notebookWebview = new NotebookWebview(context, workspace);
            
            this._notebookPanel = new NotebookPanel(workspace, context, Extension.notebookSerializer, notebookWebview);
            await this.notebookPanel.initialize();

            const notebookController = new WTNotebookController(context, workspace, this.notebookPanel, Extension.notebookSerializer);
            await this.notebookSerializer.init(context, workspace, this.notebookPanel, notebookController);
            report("Loaded notebook");

            this._searchResultsView = new SearchResultsView(workspace, context);
            this._searchBarView = new SearchBarView(context, workspace, this.searchResultsView);
            this.searchResultsView.initialize();
            report("Loaded search bad");

            this._codeMode = new CoderModer(context);
            const wordCountStatus = new WordCount(context);
            this._statusBarTimer = new StatusBarTimer(context);
            report("Loaded status bar items");

            new FileLinker(context, workspace);
            const linker = new DocumentLinker(context);

            this._timedViews = new TimedView(context, [
                ['wt.notebook.tree', 'notebook', this.notebookPanel],
                ['wt.todo', 'todo', this.todoView],
                ['wt.documentLinker', 'documentLinker', linker],
                ['wt.spellcheck', 'spellcheck', spellcheck],
                ['wt.wordWatcher', 'wordWatcher', this.wordWatcher],
                ['wt.spacingHighlights', 'spacingHighlights', spacingHighlights],
                // ['wt.proximity', 'proximity', proximity],
                ['wt.very', 'very', veryIntellisense],  
                ['wt.colors', 'colors', colorIntellisense],
                ['wt.textStyle', 'textStyle', textStyles],
                ['wt.autocorrections', 'autocorrections', autocorrection],
                ['wt.overview', 'overview', fragmentOverview],
                ['wt.wtSearch.results', 'searchResults', this.searchResultsView],
            ]);

            this._tabLabels = new TabLabels(context);

            // Register commands for the toolbar (toolbar that appears when editing a .wt file)
            Toolbar.registerCommands(context);
        
            // Register commands for the export webview form
            ExportForm.registerCommands(context.extensionUri, context, workspace, this.outlineView);
        
            // Initialize the file access manager
            // Manages any accesses of .wt fragments, for various uses such as drag/drop in outline view or creating new
            //        fragment/snips/chapters in the outline view
            FileAccessManager.initialize(context);
            vscode.commands.executeCommand('setContext', 'wt.todo.visible', false);
            
            this._packageableItems = [
                this.outlineView, this.synonymsWebview, this.timedViews, new FileAccessManager(),
                this.personalDictionary, this.colorGroups, this.wh, reloadWatcher, this.tabStates,
                autocorrection, this.searchBarView
            ];
            context.subscriptions.push(vscode.commands.registerCommand('wt.getPackageableItems', () => this.getPackageableItems()));

            // Lastly, clear the 'tmp' folder
            // This is used to store temporary data for a session and should not last between sessions
            const tmpFolderPath = vscode.Uri.joinPath(this.rootPath, 'tmp');
            vscode.workspace.fs.delete(tmpFolderPath, { recursive: true, useTrash: false });

            // Setting to make writing dialogue easier -- always skip past closing dialogue quotes
            const configuration = vscode.workspace.getConfiguration();
            configuration.update("editor.autoClosingOvertype", "always", vscode.ConfigurationTarget.Workspace);

            // Add command for setting ripgrep location
            // Command must go here because the web extension cannot use ripgrep and it's annoying to add it into the existing search controller code
            this.context.subscriptions.push(vscode.commands.registerCommand("wt.wtSearch.setRipGrepLocation", async () => {
                const configuration = vscode.workspace.getConfiguration();
                const oldLocation: string | undefined = configuration.get<string>('wt.wtSearch.ripGrepLocation');
    
                const newLocation = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    defaultUri: oldLocation ? vscode.Uri.file(oldLocation) : undefined,
                    openLabel: "Select",
                    title: "Select 'rg' binary to use for WTANIWE searches",
                });
                if (!newLocation) return;

                const newPath = newLocation[0].fsPath;
                await configuration.update('wt.wtSearch.ripGrepLocation', newPath, vscode.ConfigurationTarget.Workspace);
                RipGrep.rgPath = getRipGrepBinarySearchPromise();
            }));

            await TabLabels.assignNamesForOpenTabs();
            report("Loaded tab labels");

            activateSpeak(context);
            activateDebug(context);
            report("Loaded text-to-speech debugger");

            reloadWatcher.checkForRestoreTabs();
            if (this.outlineView.view.visible) {
                await this.outlineView.selectActiveDocument(vscode.window.activeTextEditor);
            }
            report("Finished.");
        }
        catch (e) {
            this.handleLoadFailure(e);
            throw e;
        }
    };

    private static async handleLoadFailure (err: Error | string | unknown) {
        // First thing to do, is to set wt.valid context value to false
        // This will display the welcome scene in the wt.outline view
        await vscode.commands.executeCommand('setContext', 'wt.valid', false);
    
        // Tell the user about the load failure
        await vscode.window.showErrorMessage(`Error loading the IWE workspace: ${err}`);
    }
}


export function activate (context: vscode.ExtensionContext) {
    Extension.activateExtension(context);
    return context;
}

export function deactivate (): Promise<void> {
    return Workspace.packageContextItems(true);
}