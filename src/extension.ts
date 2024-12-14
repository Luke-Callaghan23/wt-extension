'use strict';

import * as vscode from 'vscode';
// import * as console from './vsconsole';
import { ImportFileSystemView } from './import/importFileSystemView';
import { WHViewPorvider as WHViewProvider } from './whWebview/whWebview';
import { CoderModer } from './codeMode/codeMode';
import { activateSpeak } from './ttsDebugger/tts/tts';
import { activateDebug } from './ttsDebugger/debugger/debugExtention';
import { ExportForm } from './export/exportFormView';
import { importWorkspace } from './workspace/importExport/importWorkspace';

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
import { WorkBible } from './workBible/workBible';
import { StatusBarTimer } from './statusBarTimer/statusBarTimer';
import { TabLabels } from './tabLabels/tabLabels';
import { searchFiles } from './miscTools/searchFiles';
import { ReloadWatcher } from './miscTools/reloadWatcher';
import { convertFileNames } from './miscTools/convertFileNames';
import { ScratchPadView } from './scratchPad/scratchPadView';
import { TabStates } from './miscTools/tabStates';
import { Autocorrect } from './autocorrect/autocorrect';
import { FileLinker } from './miscTools/fileLinker';

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
	public static todoView: TODOsView;
	public static workspace: Workspace;
	public static context: vscode.ExtensionContext;

    public static initialize (
		outlineView: OutlineView, 
		recyclingBinView: RecyclingBinView, 
		scratchPadView: ScratchPadView, 
		workBible: WorkBible,
		todoView: TODOsView,
		workspace: Workspace,
		context: vscode.ExtensionContext
	) {
        ExtensionGlobals.outlineView = outlineView;
        ExtensionGlobals.recyclingBinView = recyclingBinView;
        ExtensionGlobals.scratchPadView = scratchPadView;
        ExtensionGlobals.workBible = workBible;
		ExtensionGlobals.todoView = todoView;
		ExtensionGlobals.workspace = workspace;
		ExtensionGlobals.context = context;
	}
}

// To be called whenever a workspace is successfully loaded
// Loads all the content for all the views for the wt extension
async function loadExtensionWorkspace (context: vscode.ExtensionContext, workspace: Workspace): Promise<void> {
	try {
		const outline = new OutlineView(context, workspace);				// wt.outline
		await outline.init();
		const importFS = new ImportFileSystemView(context, workspace);		// wt.import.fileSystem
		const synonyms = new SynonymViewProvider(context, workspace);		// wt.synonyms
		const wh = new WHViewProvider(context, workspace);		// wt.synonyms
		const todo = new TODOsView(context, workspace);						// wt.todo
		await todo.init();
		const wordWatcher = new WordWatcher(context, workspace);			// wt.wordWatcher
		const proximity = new Proximity(context, workspace);
		const textStyles = new TextStyles(context, workspace);	
		const recycleBin = new RecyclingBinView(context, workspace);		
		await recycleBin.initialize();

		const autocorrection = new Autocorrect(context, workspace);
		const personalDictionary = new PersonalDictionary(context, workspace);
		const synonymsIntellisense = new Intellisense(context, workspace, personalDictionary, true);
		const spellcheck = new Spellcheck(context, workspace, personalDictionary, autocorrection);
		const veryIntellisense = new VeryIntellisense(context, workspace);
        const colorGroups = new ColorGroups(context);
		const colorIntellisense = new ColorIntellisense(context, workspace, colorGroups);
		const reloadWatcher = new ReloadWatcher(workspace, context);
		const scratchPad = new ScratchPadView(context, workspace);
		await scratchPad.init();
		
		const tabStates = new TabStates(context, workspace);


		new CoderModer(context);

		const workBible = new WorkBible(workspace, context);
		await workBible.initialize()
		
		ExtensionGlobals.initialize(outline, recycleBin, scratchPad, workBible, todo, workspace, context);
		
		const wordCountStatus = new WordCount();
		const statusBarTimer = new StatusBarTimer(context);
		new FileLinker(context, workspace);

		const timedViews = new TimedView(context, [
			['wt.workBible.tree', 'workBible', workBible],
			['wt.todo', 'todo', todo],
			['wt.wordWatcher', 'wordWatcher', wordWatcher],
			// ['wt.proximity', 'proximity', proximity],
			['wt.spellcheck', 'spellcheck', spellcheck],
			['wt.very', 'very', veryIntellisense],  
			['wt.colors', 'colors', colorIntellisense],
			['wt.textStyle', 'textStyle', textStyles],
			['wt.autocorrections', 'autocorrections', autocorrection]
		]);

		const tabLabels = new TabLabels();


		// Register commands for the toolbar (toolbar that appears when editing a .wt file)
		Toolbar.registerCommands();
	
		// Register commands for the export webview form
		ExportForm.registerCommands(context.extensionUri, context, workspace, outline);
	
		// Initialize the file access manager
		// Manages any accesses of .wt fragments, for various uses such as drag/drop in outline view or creating new
		//		fragment/snips/chapters in the outline view
		FileAccessManager.initialize();
		vscode.commands.executeCommand('setContext', 'wt.todo.visible', false);
		vscode.commands.registerCommand('wt.getPackageableItems', () => packageForExport([
			outline, synonyms, timedViews, new FileAccessManager(),
			personalDictionary, colorGroups, wh, reloadWatcher, tabStates,
			autocorrection
		]));

		// Lastly, clear the 'tmp' folder
		// This is used to store temporary data for a session and should not last between sessions
		const tmpFolderPath = vscode.Uri.joinPath(rootPath, 'tmp');
		vscode.workspace.fs.delete(tmpFolderPath, { recursive: true, useTrash: false });

        // Setting to make writing dialogue easier -- always skip past closing dialogue quotes
        const configuration = vscode.workspace.getConfiguration();
        configuration.update("editor.autoClosingOvertype", "always", vscode.ConfigurationTarget.Workspace)


		await TabLabels.assignNamesForOpenTabs();
		activateSpeak(context);
		activateDebug(context);

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
	else {
		// If the attempt to load the workspace failed, then register commands both for loading 
		//		a workspace from a .iwe environment file or for creating a new iwe environment
		//		at the current location
		vscode.commands.registerCommand('wt.importWorkspace', () => {
			importWorkspace(context).then((ws) => {
				if (ws) {
					loadExtensionWorkspace(context, ws);
					return;
				}
				// Inform the user of the failed import 
				vscode.window.showInformationMessage(`Could not import .iwe workspace`, {
					modal: true,
					detail: 'Make sure the .iwe file you provided is the exact same as the one created by this extension.'
				}, 'Okay');
			})
			.catch(err => {
				handleLoadFailure(err);
				throw err;
			});
		});
		vscode.commands.registerCommand('wt.createWorkspace', () => {
			createWorkspace(context).then((ws) => {
				loadExtensionWorkspace(context, ws);
			})
			.catch(err => {
				handleLoadFailure(err);
				throw err;
			});
		});
	}
}

export function deactivate (): Promise<void> {
	return Workspace.packageContextItems(true);
}