'use strict';

import * as vscode from 'vscode';
import * as console from './vsconsole';
import { ImportFileSystemView } from './import/importFileSystemView';
import { OutlineView } from './outline/outlineView';
import { TODOsView } from './TODO/TODOsView';
import { WordWatcher } from './wordWatcher/wordWatcher';
import { ExportForm } from './export/exportFormView';
import { SynonymViewProvider } from './synonyms/synonymsView';
import { Toolbar } from './toolbar';
import { importWorkspace } from './workspace/importExport/importWorkspace';

import { loadWorkspace, createWorkspace, Workspace } from './workspace/workspace';
import { FileAccessManager } from './fileAccesses';
import { packageForExport } from './packageable';
import { TimedView } from './timedView';
import { Proximity } from './proximity/Proximity';

export const decoder = new TextDecoder();
export const encoder = new TextEncoder();
export let rootPath: vscode.Uri;
export const wordSeparator: string = '(^|[\\.\\?\\:\\;,\\(\\)!\\&\\s\\+\\-\\n]|$)';
export const wordSeparatorRegex = new RegExp(wordSeparator.split('|')[1], 'g');
export const sentenceSeparator: RegExp = /[.?!]/g;
export const paragraphSeparator: RegExp = /\n\n/g;

// To be called whenever a workspace is successfully loaded
// Loads all the content for all the views for the wt extension
async function loadExtensionWorkspace (context: vscode.ExtensionContext, workspace: Workspace): Promise<void> {
	try {
		const outline = new OutlineView(context, workspace);				// wt.outline
		await outline.init();
		const importFS = new ImportFileSystemView(context, workspace);		// wt.import.fileSystem
		const synonyms = new SynonymViewProvider(context, workspace);		// wt.synonyms
		const todo = new TODOsView(context, workspace);						// wt.todo
		await todo.init();
		const wordWatcher = new WordWatcher(context, workspace);			// wt.wordWatcher
		const proximity = new Proximity(context, workspace);
	
		const timedViews = new TimedView(context, [
			['wt.todo', todo],
			['wt.wordWatcher', wordWatcher],
			['wt.proximity', proximity]
		]);

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
			outline, synonyms, timedViews
		]));
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
}

async function activateImpl (context: vscode.ExtensionContext) {

	// Load the root path of file system where the extension was loaded
	rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.parse('.');

	
	// rootPath = rootPath.replaceAll('\\', '/');
	// rootPath = rootPath.replaceAll('c:/', 'C:\\');


	vscode.commands.registerCommand('wt.reload', async () => {
		const workspace = await loadWorkspace(context);
		if (workspace !== null) {
			loadExtensionWorkspace(context, workspace);
		}
	});

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