/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import { Workspace } from '../../../workspace/workspace';
import { FileSystem } from '../fileSystem/fileSystem';
import * as fsFunctions from '../fileSystem/fileSystemProviderFunctions';
import { ImportDocumentProvider } from './importDropProvider';
import * as console from './../../../vsconsole';
import { _ } from '../fileSystem/fileSystemDefault';
import { ImportForm } from '../../webviews/import/importFormView';
import { throws } from 'assert';


export interface Entry {
	uri: vscode.Uri;
	type: vscode.FileType;
}

export class ImportFileSystemView implements vscode.TreeDataProvider<Entry>, FileSystem {
    
	// File system functions
    watch = fsFunctions.watch;
	stat = fsFunctions.stat;
	readDirectory = fsFunctions.readDirectory;
	createDirectory = fsFunctions.createDirectory;
	readFile = fsFunctions.readFile;
	writeFile = fsFunctions.writeFile;
	delete = fsFunctions.deleteFile;
	rename = fsFunctions.renameFile;
    

	excludedFiles: string[];

	// tree data provider
	//#region

	async getChildren (element?: Entry): Promise<Entry[]> {
		if (element) {
			const children = await this.readDirectory(element.uri);
			const fsChildren: {
				uri: vscode.Uri;
				type: vscode.FileType;
			}[] = [];
			children.forEach(([ name, type ]) => {
				const uri = vscode.Uri.parse(
					type === vscode.FileType.Directory
						? path.join(element.uri.fsPath, name) + '/'
						: path.join(element.uri.fsPath, name)
				);
					
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
		treeItem.label = path.basename((treeItem.resourceUri as vscode.Uri).fsPath);

		const isRootFolder: boolean = treeItem.resourceUri?.fsPath === this.importFolder.fsPath;

		// Add a highlight to the label of the node, if it is excluded
		let excluded = false;
		if (isRootFolder) {
			console.log('hello')
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

	async handleImportUri (uri: vscode.Uri) {
		// TODO wait for microsoft to implement file dropping
	}

	async handleImportDialog () {
		const uris = await vscode.window.showOpenDialog({ 
			canSelectFiles: true, 
			canSelectFolders: true, 
			canSelectMany: true, 
			openLabel: 'import', 
			filters: {
				// eslint-disable-next-line @typescript-eslint/naming-convention
				'Text': [
					'pdf',
					'wt',
					'txt',
					'docx',
					'html'
				]
			}
		});
		if (!uris) return;
		
		// Ask the user if their sure about the copy proceedure
		const proceed = await vscode.window.showInformationMessage(`Copying ${uris.length} resources`, {
			modal: true,
			detail: 'Data will be copied, not moved.'
		}, 'Okay', 'Cancel');
		if (proceed === 'Cancel' || proceed === undefined) return;

		// Import each uri
		// Don't need to await them, as none of the imports (should) rely on each other
		uris.forEach(uri => this.handleImportUri(uri));
	}

	private filterResource (resource: Entry) {
		this.excludedFiles.push(resource.uri.fsPath);
		this.refresh();
	}

	private defilterResource (resource: Entry) {
		const index = this.excludedFiles.findIndex(file => file.includes(resource.uri.fsPath));
		this.excludedFiles.splice(index, 1);
		this.refresh();
	}

	registerCommands() {
		
		// Open import form
		vscode.commands.registerCommand('wt.import.fileExplorer.openImportWindow', () => {
			new ImportForm(this.context.extensionUri, this.context, this.allDocs);
		});
		
		vscode.commands.registerCommand('wt.import.fileExplorer.importFile', (uri: vscode.Uri) => {
			new ImportForm(this.context.extensionUri, this.context, [ uri ]);
		});

		vscode.commands.registerCommand('wt.import.fileExplorer.importFolder', (folderUri: vscode.Uri) => {
			const subFolder = this.allDocs.filter(file => file.fsPath.includes(folderUri.fsPath) && file.fsPath !== folderUri.fsPath);
			new ImportForm(this.context.extensionUri, this.context, subFolder);
		});

		vscode.commands.registerCommand('wt.import.fileExplorer.refresh', () => this.refresh());
		vscode.commands.registerCommand('wt.import.fileExplorer.filter', (resource) => this.filterResource(resource));
		vscode.commands.registerCommand('wt.import.fileExplorer.defilter', (resource) => this.defilterResource(resource));


		// Help message
		const importFiles = [...this.workspace.importFileTypes];
		const lastOne = importFiles.pop();
		const allowedFileTypes = importFiles.join("', '");
		const allowedFullTypes = `${allowedFileTypes}', and '${lastOne}'`;
		vscode.commands.registerCommand('wt.import.fileExplorer.help', () => {
			vscode.window.showInformationMessage(`Drag '${allowedFullTypes}' files into the /data/imports/ folder at the root of this workspace and hit the 'Import' button on this panel to import them into the workspace.`, { modal: true });
		});

		// Adding files to the import folder
		vscode.commands.registerCommand('wt.import.fileExplorer.importFiles', () => this.handleImportDialog());


		vscode.commands.registerCommand('wt.import.fileExplorer.openFileExplorer', () => {
			vscode.window.showOpenDialog();
		});
	}

    private importFolder: vscode.Uri;
	constructor(
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
		this.excludedFiles = [];
        this.importFolder = vscode.Uri.parse(this.workspace.importFolder);
        this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        
		context.subscriptions.push(vscode.window.createTreeView('wt.import.fileExplorer', { treeDataProvider: this }));
        this.registerCommands();
		
		// TODO wait for microsoft to implement file dropping
		// const selector: vscode.DocumentSelector = { 
		// 	pattern: "**/*",
		// 	scheme: 'file',
		// };
		// const documentDropProvider = new ImportDocumentProvider(this.workspaceFolder, this.workspace);
		// vscode.languages.registerDocumentDropEditProvider(selector, documentDropProvider);
	}
}