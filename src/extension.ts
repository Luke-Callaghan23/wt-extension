'use strict';

import * as vscode from 'vscode';
import * as console from './vsconsole';
import { ImportFileSystemView } from './panels/treeViews/import/importFileSystemView';
import { OutlineView } from './panels/treeViews/outline/outlineView';
import { TODOsView } from './panels/treeViews/TODO/TODOsView';
import { WordWatcher } from './panels/treeViews/wordWatcher/wordWatcher';
import { ExportForm } from './panels/webviews/export/exportFormView';
import { SynonymViewProvider } from './panels/webviews/synonymsView';
import { Toolbar } from './toolbar';
import { importWorkspace } from './workspace/importExport/importWorkspace';

import { loadWorkspace, createWorkspace, Workspace } from './workspace/workspace';
import { FileAccessManager } from './fileAccesses';

export let rootPath: string;

// To be called whenever a workspace is successfully loaded
// Loads all the content for all the views for the wt extension
function loadExtensionWorkspace (context: vscode.ExtensionContext, workspace: Workspace) {
	try {
		const outline = new OutlineView(context, workspace);											// wt.outline
		new TODOsView(context, workspace);																// wt.todo
		new ImportFileSystemView(context, workspace);													// wt.import.fileSystem
		new SynonymViewProvider(context.extensionUri, context);											// wt.synonyms
		new WordWatcher(context, workspace);															// wt.wordWatcher
	
		// Register commands for the toolbar (toolbar that appears when editing a .wt file)
		Toolbar.registerCommands();
	
		// Register commands for the export webview form
		ExportForm.registerCommands(context.extensionUri, context, workspace, outline);
	
		// Initialize the file access manager
		// Manages any accesses of .wt fragments, for various uses such as drag/drop in outline view or creating new
		//		fragment/snips/chapters in the outline view
		FileAccessManager.initialize();

		vscode.commands.executeCommand('setContext', 'wt.todo.visible', false);
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

export function activate(context: vscode.ExtensionContext) {

	// Load the root path of file system where the extension was loaded
	rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : '.';

	// TOTEST: does this make it work for windows?
	rootPath = rootPath.replaceAll('\\', '/');

	vscode.commands.registerCommand('wt.reload', () => {
		let workspace = loadWorkspace(context);
		if (workspace !== null) {
			loadExtensionWorkspace(context, workspace);
		}
	});

	// Attempt to load a workspace from the current location
	let workspace = loadWorkspace(context);
	if (workspace !== null) {
		loadExtensionWorkspace(context, workspace);
	}
	else {
		// If the attempt to load the workspace failed, then register commands both for loading 
		//		a workspace from a .iwe environment file or for creating a new iwe environment
		//		at the current location
		vscode.commands.registerCommand('wt.importWorkspace', () => {
			importWorkspace(context).then((ws) => {
				console.log(ws);
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