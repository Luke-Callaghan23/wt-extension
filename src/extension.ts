'use strict';

import * as vscode from 'vscode';
// import * as console from './vsconsole';
import { ImportFileSystemView } from './import/importFileSystemView';
import { WHViewPorvider as WHViewProvider } from './whWebview/whWebview';
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
import { Workspace } from './workspace/workspaceClass';
import { loadWorkspace, createWorkspace } from './workspace/workspace';
import { FileAccessManager } from './miscTools/fileAccesses';
import { packageForExport } from './packageable';
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
import { Notes } from './notes/notes';
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
import { FragmentLinker } from './miscTools/fragmentLinker';
import { defaultProgress, getSectionedProgressReporter, progressOnViews } from './miscTools/help';

export const decoder = new TextDecoder();
export const encoder = new TextEncoder();
export let rootPath: vscode.Uri;
export const wordSeparator: string = '(^|[\\.\\?\\:\\;,\\(\\)!\\&\\s\\+\\-\\n"\'^_*~]|$)';
export const wordSeparatorRegex = new RegExp(wordSeparator.split('|')[1], 'g');
export const sentenceSeparator: RegExp = /[.?!]/g;
export const paragraphSeparator: RegExp = /\n\n/g;

export class ExtensionGlobals {
    public static outlineView: OutlineView;
    public static recyclingBinView: RecyclingBinView;
    public static scratchPadView: ScratchPadView;
    public static notes: Notes;
    public static todoView: TODOsView;
    public static workspace: Workspace;
    public static context: vscode.ExtensionContext;

    public static initialize (
        outlineView: OutlineView, 
        recyclingBinView: RecyclingBinView, 
        scratchPadView: ScratchPadView, 
        notes: Notes,
        todoView: TODOsView,
        workspace: Workspace,
        context: vscode.ExtensionContext
    ) {
        ExtensionGlobals.outlineView = outlineView;
        ExtensionGlobals.recyclingBinView = recyclingBinView;
        ExtensionGlobals.scratchPadView = scratchPadView;
        ExtensionGlobals.notes = notes;
        ExtensionGlobals.todoView = todoView;
        ExtensionGlobals.workspace = workspace;
        ExtensionGlobals.context = context;
    }
}

// To be called whenever a workspace is successfully loaded
// Loads all the content for all the views for the wt extension
async function loadExtensionWorkspace (
    context: vscode.ExtensionContext, 
    workspace: Workspace,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    workDivision: number = -1,
): Promise<void> {
    try {
        const report = progress 
            ? getSectionedProgressReporter ([
                "Loaded outline",
                "Loaded TODO tree",
                "Loaded recycling bin",
                "Loaded spellchecker",
                "Loaded intellisense",
                "Loaded scratch pad",
                "Loaded fragment overview",
                "Loaded tab groups",
                "Loaded search bad",
                "Loaded notes",
                "Loaded status bar items",
                "Loaded tab labels",
                "Loaded text-to-speech debugger",
                "Finished.",
            ] as const, progress, workDivision)
            : () => {};


        const outline = new OutlineView(context, workspace);                // wt.outline
        await outline.init();
        report("Loaded outline");

        const importFS = new ImportFileSystemView(context, workspace);        // wt.import.fileSystem
        const synonyms = new SynonymViewProvider(context, workspace);        // wt.synonyms
        const wh = new WHViewProvider(context, workspace);        // wt.synonyms
        const todo = new TODOsView(context, workspace);                        // wt.todo
        await todo.init();
        report("Loaded TODO tree");

        const wordWatcher = new WordWatcher(context, workspace);            // wt.wordWatcher
        const proximity = new Proximity(context, workspace);
        const textStyles = new TextStyles(context, workspace);    
        const recycleBin = new RecyclingBinView(context, workspace);        
        await recycleBin.initialize();
        report("Loaded recycling bin");

        const autocorrection = new Autocorrect(context, workspace);
        const personalDictionary = new PersonalDictionary(context, workspace);
        const spellcheck = new Spellcheck(context, workspace, personalDictionary, autocorrection);
        report("Loaded spellchecker");

        const synonymsIntellisense = new Intellisense(context, workspace, personalDictionary, true);
        const veryIntellisense = new VeryIntellisense(context, workspace);
        const colorGroups = new ColorGroups(context);
        const colorIntellisense = new ColorIntellisense(context, workspace, colorGroups);
        report("Loaded intellisense");

        const reloadWatcher = new ReloadWatcher(workspace, context);
        const scratchPad = new ScratchPadView(context, workspace);
        await scratchPad.init();
        report("Loaded scratch pad");

        const fragmentOverview = new FragmentOverviewView(context, workspace);
        report("Loaded fragment overview");
        
        const tabStates = new TabStates(context, workspace);
        report("Loaded tab groups");

        const notes = new Notes(workspace, context);
        await notes.initialize()
        report("Loaded notes");

        ExtensionGlobals.initialize(outline, recycleBin, scratchPad, notes, todo, workspace, context);

        const searchResultsView = new SearchResultsView(workspace, context);
        const searchBarView = new SearchBarView(context, workspace, searchResultsView);
        searchResultsView.initialize();
        report("Loaded search bad");

        new CoderModer(context);
        const wordCountStatus = new WordCount(context);
        const statusBarTimer = new StatusBarTimer(context);
        report("Loaded status bar items");

        new FileLinker(context, workspace);
        new FragmentLinker(context);

        const timedViews = new TimedView(context, [
            ['wt.notes.tree', 'notes', notes],
            ['wt.todo', 'todo', todo],
            ['wt.wordWatcher', 'wordWatcher', wordWatcher],
            // ['wt.proximity', 'proximity', proximity],
            ['wt.spellcheck', 'spellcheck', spellcheck],
            ['wt.very', 'very', veryIntellisense],  
            ['wt.colors', 'colors', colorIntellisense],
            ['wt.textStyle', 'textStyle', textStyles],
            ['wt.autocorrections', 'autocorrections', autocorrection],
            ['wt.overview', 'overview', fragmentOverview]
        ]);

        const tabLabels = new TabLabels(context);

        // Register commands for the toolbar (toolbar that appears when editing a .wt file)
        Toolbar.registerCommands(context);
    
        // Register commands for the export webview form
        ExportForm.registerCommands(context.extensionUri, context, workspace, outline);
    
        // Initialize the file access manager
        // Manages any accesses of .wt fragments, for various uses such as drag/drop in outline view or creating new
        //        fragment/snips/chapters in the outline view
        // FileAccessManager.initialize();
        vscode.commands.executeCommand('setContext', 'wt.todo.visible', false);
        context.subscriptions.push(vscode.commands.registerCommand('wt.getPackageableItems', () => packageForExport([
            outline, synonyms, new FileAccessManager(),
            personalDictionary, wh,  
            autocorrection, 
        ])));

        // Lastly, clear the 'tmp' folder
        // This is used to store temporary data for a session and should not last between sessions
        const tmpFolderPath = vscode.Uri.joinPath(rootPath, 'tmp');
        vscode.workspace.fs.delete(tmpFolderPath, { recursive: true, useTrash: false });

        // Setting to make writing dialogue easier -- always skip past closing dialogue quotes
        const configuration = vscode.workspace.getConfiguration();
        configuration.update("editor.autoClosingOvertype", "always", vscode.ConfigurationTarget.Workspace)

        // await TabLabels.assignNamesForOpenTabs();
        report("Loaded tab labels");

        activateSpeak(context);
        activateDebug(context);
        report("Loaded text-to-speech debugger");

        await reloadWatcher.checkForRestoreTabs();
        await outline.selectActiveDocument(vscode.window.activeTextEditor);
        report("Finished.");
    }
    catch (e) {
        handleLoadFailure(e);
        throw e;
    }
};

async function handleLoadFailure (err: Error | string | unknown) {
    // First thing to do, is to set wt.valid context value to false
    // This will display the welcome scene in the wt.outline view
    await vscode.commands.executeCommand('setContext', 'wt.valid', false);

    // Tell the user about the load failure
    await vscode.window.showErrorMessage(`Error loading the IWE workspace: ${err}`);
}

export function activate (context: vscode.ExtensionContext) {
    activateImpl(context);
    return context;
}


async function loadExtensionWithProgress (context: vscode.ExtensionContext, title: "Starting Integrated Writing Environment" | "Reloading Integrated Writing Environment"): Promise<boolean> {
    return defaultProgress(title, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
        const workspace = await loadWorkspace(context);
        progress.report({ message: "Loaded workspace" });
        if (workspace === null) return false;
    
        await loadExtensionWorkspace(context, workspace, progress, 1);
        progress.report({ message: "Loaded extension" })
        return true;
    });
}

async function activateImpl (context: vscode.ExtensionContext) {
    // Load the root path of file system where the extension was loaded
    rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
        ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.parse('.');

    context.subscriptions.push(vscode.commands.registerCommand("wt.walkthroughs.openIntro", async () => {
        return vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `luke-callaghan.wtaniwe#wt.introWalkthrough`, false);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("wt.walkthroughs.openImports", async () => {
        return vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `luke-callaghan.wtaniwe#wt.importsWalkthrough`, false);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("wt.searchFiles", searchFiles));    
    context.subscriptions.push(vscode.commands.registerCommand('wt.convert', () => convertFileNames()));

    context.subscriptions.push(vscode.commands.registerCommand('wt.reload', async () => {
        return loadExtensionWithProgress(context, "Reloading Integrated Writing Environment");
    }));

    const loadWorkspaceSuccess = await loadExtensionWithProgress(context, "Starting Integrated Writing Environment");
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
                if (!ws) return handleLoadFailure(`Could not import .iwe workspace: Make sure the .iwe file you provided is the exact same as the one created by this extension.`);

                await loadExtensionWorkspace(context, ws, progress, workDivision);
                return;
            }
            catch (err: any) {
                return handleLoadFailure(err);
            }
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('wt.createWorkspace', async () => {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Creating Workspace"
        }, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
            try {
                const workDivision = 0.5;
                const ws = await createWorkspace(context);
                await loadExtensionWorkspace(context, ws, progress, workDivision);
            }
            catch(err: any) {
                handleLoadFailure(err);
                throw err;
            }
        });
    }));
}

export function deactivate (): Promise<void> {
    return Workspace.packageContextItems(true);
}