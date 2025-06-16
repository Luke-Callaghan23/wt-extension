/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri'
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../miscTools/vsconsole';
import { DroppedSourceInfo, ImportForm } from './importFormView';
import { ImportDocumentProvider } from './importDropProvider';
import * as extension from './../extension';
import {sep} from 'path';
import { compareFsPath, getNodeNamePath, getDateString, statFile } from '../miscTools/help';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';

export interface Entry {
	uri: vscode.Uri;
	type: vscode.FileType;
}

export class ImportFileSystemView implements vscode.TreeDataProvider<Entry> {
	excludedFiles: string[];

	// tree data provider
	//#region

	async getChildren (element?: Entry): Promise<Entry[]> {
		if (element) {
			const children = await vscode.workspace.fs.readDirectory(element.uri);
			const fsChildren: {
				uri: vscode.Uri;
				type: vscode.FileType;
			}[] = [];
			children.forEach(([ name, type ]) => {
				const uri = type === vscode.FileType.Directory
					? vscode.Uri.joinPath(element.uri, name)
					: vscode.Uri.joinPath(element.uri, name);
					
				const ret = { uri, type };
				if (type === vscode.FileType.Directory) {
					fsChildren.push(ret);
				}
				else if (type === vscode.FileType.File) {
					const correctFT = this.workspace.importFileTypes.find(ft => name.endsWith(ft));
					if (correctFT) {
						fsChildren.push(ret);
					}
				}
			});
			return fsChildren;
		}

		return [ {
			type: vscode.FileType.Directory,
			uri: this.importFolder
		} ];
	}

	getTreeItem (element: Entry): vscode.TreeItem {
		const treeItem = new vscode.TreeItem (
			element.uri, 
			element.type === vscode.FileType.Directory 
				? vscode.TreeItemCollapsibleState.Expanded 
				: vscode.TreeItemCollapsibleState.None
		);
		treeItem.label = vscodeUris.Utils.basename(<vscodeUris.URI>treeItem.resourceUri);

		const isRootFolder: boolean = treeItem.resourceUri ? compareFsPath(treeItem.resourceUri, this.importFolder) : false;

		// Add a highlight to the label of the node, if it is excluded
		let excluded = false;
		if (isRootFolder) {
			treeItem.contextValue = 'import-root';
		}
		else if (this.excludedFiles.find(ef => element.uri.fsPath.includes(ef))) {
			excluded = true;
			const label = treeItem.label as string;
			treeItem.label = {
				highlights: [[ 0, label.length ]],
				label
			};
			treeItem.contextValue = 'filtered';
		}
		else {
			treeItem.contextValue = 'unfiltered';
		}
		
		// Construct a tree item from this file tree node
		if (element.type === vscode.FileType.File) {
			if (!excluded) {
				this.allDocs.push(element.uri);
			}
			treeItem.command = { 
                command: 'wt.import.fileExplorer.importFile', 
                title: "Import File", 
                arguments: [ element.uri ],
            };
		}
		else if (!isRootFolder) {
			treeItem.command = {
				command: 'wt.import.fileExplorer.importFolder',
				title: "Import Folder",
				arguments: [ element.uri ]
			};
		}
		return treeItem;
	}
	//#endregion

	// Refresh the tree data information
	//#region
	public _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

	private allDocs: vscode.Uri[] = [];
	private _onDidChangeTreeData: vscode.EventEmitter<Entry | undefined> = new vscode.EventEmitter<Entry | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Entry | undefined> = this._onDidChangeTreeData.event;
	refresh () {
		this.allDocs = [];
		this._onDidChangeTreeData.fire(undefined);
	}
	//#endregion

	private filterResource (resource: Entry) {
		this.excludedFiles.push(resource.uri.fsPath);
		this.refresh();
	}

	private defilterResource (resource: Entry) {
		const index = this.excludedFiles.findIndex(file => file.includes(resource.uri.fsPath));
		this.excludedFiles.splice(index, 1);
		this.refresh();
	}

	private async importDroppedDocument (docs: vscode.Uri[], dropped: OutlineNode, copy: boolean = true) {
		const fileNames: string[] = [];
		const exts = new Set<string>();
		const moves: [ vscode.Uri, vscode.Uri ][] = [];


		let destinationFolder: vscode.Uri;
		if (docs.length > 1) {
			destinationFolder = vscode.Uri.joinPath(this.importFolder, `Imported ${getDateString()}`);
			if (!(await statFile(destinationFolder))) {
				await vscode.workspace.fs.createDirectory(destinationFolder);
			}
		}
		else {
			destinationFolder = this.importFolder;
		}
		
		// Only import the incoming document as a chapter if it was dropped directly into the '/data/chapters' folder
		const destinationKind: 'snip' | 'chapter' = compareFsPath(dropped.data.ids.uri, extension.ExtensionGlobals.workspace.chaptersFolder)
			? 'chapter'
			: 'snip'
		const nodeNamePath = await getNodeNamePath(dropped);
		
		for (let index = 0; index < docs.length; index++) {
			const doc = docs[index];
			const filename = vscodeUris.Utils.basename(doc);
			fileNames.push(filename);
			exts.add(vscodeUris.Utils.extname(doc));

			const finalLocation = vscode.Uri.joinPath(destinationFolder, filename);
			moves.push([ doc, finalLocation ]);
		}

		const response = await vscode.window.showInformationMessage(`Import '${fileNames.join("', '")}' into workspace?`, {
			modal: true,
			detail: `We detected ${docs.length} new '${[...exts].join("', '")}' file(s) added to your project at path (${nodeNamePath}).  Would you like to import them into your project as .wt file(s) in the same location?  (This action will move the original document(s) into /data/imports, and open an imports form to complete the rest of the importing)`
		}, 'Import');
		if (response !== 'Import') return;

		// If the user does want to import the file, then first move the document from its original location and into the imports folder
		const fsUpdateFunction = copy
			? vscode.workspace.fs.copy
			: vscode.workspace.fs.rename;

		const movedFiles = await Promise.all(moves.map(([ src, dest ]) => {
			return fsUpdateFunction(src, dest, { overwrite: true }).then(() => {
				return dest;
			})
		}));
		
		new ImportForm(this.context.extensionUri, this.context, movedFiles, {
			node: dropped,
			namePath: nodeNamePath,
			destination: destinationKind
		});

	}

	registerCommands() {
		
		// Open import form
		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.openImportWindow', () => {
			new ImportForm(this.context.extensionUri, this.context, this.allDocs);
		}));
		
		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importFile', (uri: vscode.Uri) => {
			new ImportForm(this.context.extensionUri, this.context, [ uri ]);
		}));

		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importFolder', (folderUris: vscode.Uri | vscode.Uri[], droppedSourceInfo?: DroppedSourceInfo) => {
			const targets: vscode.Uri[] = [];
			if (!Array.isArray(folderUris)) {
				folderUris = [ folderUris ];
			}
			for (const uri of folderUris) {
				targets.push(...this.allDocs.filter(file => file.fsPath.includes(uri.fsPath + sep) && file.fsPath !== uri.fsPath));	
			}
			if (targets.length === 0) return;
			new ImportForm(this.context.extensionUri, this.context, targets, droppedSourceInfo);
		}));

		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.refresh', () => this.refresh()));
		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.filter', (resource) => this.filterResource(resource)));
		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.defilter', (resource) => this.defilterResource(resource)));


		// Help message
		const importFiles = [...this.workspace.importFileTypes];
		const lastOne = importFiles.pop();
		const allowedFileTypes = importFiles.join("', '");
		const allowedFullTypes = `${allowedFileTypes}', and '${lastOne}'`;
		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.help', () => {
			// vscode.window.showInformationMessage(`Drag '${allowedFullTypes}' files into the /data/imports/ folder at the root of this workspace and hit the 'Import' button on this panel to import them into the workspace.`, { modal: true });
			vscode.commands.executeCommand('wt.walkthroughs.openImports');
		}));

		// // Adding files to the import folder
		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importFiles', () => {
			new ImportForm(this.context.extensionUri, this.context, this.allDocs);
		}));


		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.openFileExplorer', () => {
			vscode.commands.executeCommand('revealFileInOS', this.workspace.importFolder);
		}));

		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.revealFileExplorer', (tabUri: Entry | undefined) => {
			try {
				return vscode.commands.executeCommand('revealFileInOS', tabUri?.uri || this.importFolder);
			}
			catch (err: any) {
				return vscode.commands.executeCommand('remote-wsl.revealInExplorer', tabUri?.uri || this.importFolder);
			}
		}));

		this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importDroppedDocuments', this.importDroppedDocument.bind(this)));
	}

    private importFolder: vscode.Uri;
	constructor(
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
		this.excludedFiles = [];
        this.importFolder = this.workspace.importFolder;
        this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
		this.context.subscriptions.push(this._onDidChangeFile);
		this.context.subscriptions.push(this._onDidChangeTreeData);
        
		const documentDropProvider = new ImportDocumentProvider(this.importFolder, this.workspace, this);
		context.subscriptions.push(vscode.window.createTreeView('wt.import.fileExplorer', { 
			treeDataProvider: this,
			dragAndDropController: documentDropProvider,
			showCollapseAll: true, 
		}));


		const filterWt = workspace.importFileTypes
			.filter(importExt => importExt.toLocaleLowerCase() !== 'wt')
			.join(',');
		const importWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(extension.rootPath, `data/{chapters,snips}/**/*.{${filterWt}}`),
			// `data/{chapters,snips}/**/*.{${filterWt}}`,
			false, 			// do not ignore create events
			true,			// ignore change events
			true, 			// ignore delete events
		);
		
		importWatcher.onDidCreate(async (newDoc: vscode.Uri) => {
			const dirname = vscodeUris.Utils.dirname(newDoc);
			const insertedNode = await extension.ExtensionGlobals.outlineView.getTreeElementByUri(dirname);
			if (!insertedNode) return;
			this.importDroppedDocument([ newDoc ], insertedNode, false);
		});

		context.subscriptions.push(importWatcher);
        this.registerCommands();
	}
}