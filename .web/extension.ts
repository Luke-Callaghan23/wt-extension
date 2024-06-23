'use strict';

import * as vscode from 'vscode';
import * as console from './vsconsole';
import { OutlineView } from './outline/outlineView';
import { TODOsView } from './TODO/TODOsView';
import { WordWatcher } from './wordWatcher/wordWatcher';
import { Toolbar } from './editor/toolbar';

import { SynonymViewProvider } from './synonymsWebview/synonymsView';
import { Workspace } from './workspace/workspaceClass';
import { loadWorkspace, createWorkspace } from './workspace/workspace';
import { FileAccessManager } from './fileAccesses';
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
import { WorkBible } from './workBible/workBible';
import { StatusBarTimer } from './statusBarTimer/statusBarTimer';
import { TabLabels } from './tabLabels/tabLabels';
import { searchFiles } from './searchFiles';
import { ReloadWatcher } from './reloadWatcher';
import { convertFileNames } from './miscTools/convertFileNames';
import { ScratchPadView } from './scratchPad/scratchPadView';

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
    public static workBible: WorkBible;

    public static initialize (outlineView: OutlineView, recyclingBinView: RecyclingBinView, scratchPadView: ScratchPadView, workBible: WorkBible) {
        ExtensionGlobals.outlineView = outlineView;
        ExtensionGlobals.recyclingBinView = recyclingBinView;
        ExtensionGlobals.scratchPadView = scratchPadView;
        ExtensionGlobals.workBible = workBible;
	}
}

// To be called whenever a workspace is successfully loaded
// Loads all the content for all the views for the wt extension
async function loadExtensionWorkspace (context: vscode.ExtensionContext, workspace: Workspace): Promise<void> {
	try {
		const outline = new OutlineView(context, workspace);				// wt.outline
		await outline.init();
		const synonyms = new SynonymViewProvider(context, workspace);		// wt.synonyms
		const todo = new TODOsView(context, workspace);						// wt.todo
		await todo.init();
		const wordWatcher = new WordWatcher(context, workspace);			// wt.wordWatcher
		const proximity = new Proximity(context, workspace);
		const textStyles = new TextStyles(context, workspace);			
		const recycleBin = new RecyclingBinView(context, workspace);

		const personalDictionary = new PersonalDictionary(context, workspace);
		const synonymsIntellisense = new Intellisense(context, workspace, personalDictionary, false);
		const spellcheck = new Spellcheck(context, workspace, personalDictionary);
		const veryIntellisense = new VeryIntellisense(context, workspace);
        const colorGroups = new ColorGroups(context);
		const colorIntellisense = new ColorIntellisense(context, workspace, colorGroups);
		const reloadWatcher = new ReloadWatcher(workspace, context);
		const scratchPad = new ScratchPadView(context, workspace);
		await scratchPad.init();

		
		const workBible = new WorkBible(workspace, context);
		const wordCountStatus = new WordCount();
		const statusBarTimer = new StatusBarTimer(context);

		const timedViews = new TimedView(context, [
			['wt.workBible.tree', 'workBible', workBible],
			['wt.todo', 'todo', todo],
			['wt.wordWatcher', 'wordWatcher', wordWatcher],
			// ['wt.proximity', 'proximity', proximity],
			['wt.spellcheck', 'spellcheck', spellcheck],
			['wt.very', 'very', veryIntellisense],
			['wt.colors', 'colors', colorIntellisense],
			['wt.textStyle', 'textStyle', textStyles],
		]);
		
		const tabLabels = new TabLabels(outline, recycleBin, scratchPad, workBible);

		// Register commands for the toolbar (toolbar that appears when editing a .wt file)
		Toolbar.registerCommands();
	
		// Initialize the file access manager
		// Manages any accesses of .wt fragments, for various uses such as drag/drop in outline view or creating new
		//		fragment/snips/chapters in the outline view
		FileAccessManager.initialize(outline, recycleBin, scratchPad, workBible);
		ExtensionGlobals.initialize(outline, recycleBin, scratchPad, workBible);
		vscode.commands.executeCommand('setContext', 'wt.todo.visible', false);
		vscode.commands.registerCommand('wt.getPackageableItems', () => packageForExport([
			outline, synonyms, timedViews, new FileAccessManager(), 
			personalDictionary, colorGroups, reloadWatcher
		]));
		
		// Lastly, clear the 'tmp' folder
		// This is used to store temporary data for a session and should not last between sessions
		const tmpFolderPath = vscode.Uri.joinPath(rootPath, 'tmp');
		vscode.workspace.fs.delete(tmpFolderPath, { recursive: true, useTrash: false });
		
        // Setting to make writing dialogue easier -- always skip past closing dialogue quotes
        const configuration = vscode.workspace.getConfiguration();
        configuration.update("editor.autoClosingOvertype", "always", vscode.ConfigurationTarget.Workspace)


		await TabLabels.assignNamesForOpenTabs();
		
		reloadWatcher.checkForRestoreTabs();
		outline.selectActiveDocument(vscode.window.activeTextEditor);
	}
	catch (e) {
		handleLoadFailure(e);
		throw e;
	}
};

function handleLoadFailure (err: Error | string | unknown) {
	// First thing to do, is to set wt.valid context value to false
	// This will display the welcome scene in the wt.outline view
	vscode.commands.executeCommand('setContext', 'wt.valid', false);

	// Tell the user about the load failure
	vscode.window.showErrorMessage(`Error loading the IWE workspace: ${err}`);
}

export function activate (context: vscode.ExtensionContext) {
	activateImpl(context);
	return context;
}

async function activateImpl (context: vscode.ExtensionContext) {
	vscode.commands.registerCommand("wt.walkthroughs.openIntro", () => {
		vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `luke-callaghan.wtaniwe#wt.introWalkthrough`, false);
	});
	vscode.commands.registerCommand("wt.walkthroughs.openImports", () => {
		vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `luke-callaghan.wtaniwe#wt.importsWalkthrough`, false);
	});

	// Load the root path of file system where the extension was loaded
	rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.parse('.');

	vscode.commands.registerCommand('wt.reload', async () => {
		const workspace = await loadWorkspace(context);
		if (workspace !== null) {
			loadExtensionWorkspace(context, workspace);
		}
	});

	vscode.commands.registerCommand("wt.searchFiles", searchFiles);
	
	vscode.commands.registerCommand('wt.convert', () => {
		convertFileNames();
	})

	// Attempt to load a workspace from the current location
	const workspace = await loadWorkspace(context);
	if (workspace !== null) {
		loadExtensionWorkspace(context, workspace);
	}
}