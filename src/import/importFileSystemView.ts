/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri'
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../miscTools/vsconsole';
import { DroppedSourceInfo, ImportForm } from './importFormView';
import { ImportDocumentProvider } from './importDropProvider';
import { Extension } from   './../extension';
import {sep} from 'path';
import { compareFsPath, getNodeNamePath, getDateString, statFile, __, vagueNodeSearch, readDotConfig, isSubdirectory, writeDotConfig, getLatestOrdering, showTextDocumentWithPreview } from '../miscTools/help';
import { ChapterNode, FragmentNode, OutlineNode, RootNode, SnipNode } from '../outline/nodes_impl/outlineNode';
import { ScratchPadView } from '../scratchPad/scratchPadView';
import { Ids } from '../outlineProvider/fsNodes';
import { newSnip } from '../outline/impl/createNodes';

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

    public async importDroppedDocuments (docs: vscode.Uri[], dropped: OutlineNode | undefined, copy: boolean = true) {
        dropped = dropped || Extension.outlineView.rootNodes[0];

        const fileNames: string[] = [];
        const exts = new Set<string>();
        const moves: [ vscode.Uri, vscode.Uri ][] = [];


        let destinationFolder: vscode.Uri;
        if (docs.length > 1) {
            destinationFolder = vscode.Uri.joinPath(this.importFolder, `Dropped (${getDateString()})`);
            if (!(await statFile(destinationFolder))) {
                await vscode.workspace.fs.createDirectory(destinationFolder);
            }
        }
        else {
            destinationFolder = this.importFolder;
        }
        
        // Only import the incoming document as a chapter if it was dropped directly into the '/data/chapters' folder
        const destinationKind: 'snip' | 'chapter' = compareFsPath(dropped.data.ids.uri, Extension.workspace.chaptersFolder)
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
            detail: `${docs.length} new '${[...exts].join("', '")}' file(s) added to your project at path (${nodeNamePath}).  Would you like to import them into your project?  (This action will move the original document(s) into /data/imports, and open an imports form to complete the rest of the importing)`
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

    public async importDroppedFragmentDocuments (docs: vscode.Uri[], dropped: OutlineNode | undefined | null) {
        const outlineView = Extension.outlineView;
        const rootOutlineNode = outlineView.rootNodes[0];
        const rootNode = rootOutlineNode.data as RootNode;
        dropped = dropped || rootOutlineNode;

        const newDirectoryTitle = `Dropped (${getDateString()})`;

        let finalParentNode: SnipNode | ChapterNode;
        if (dropped.data.ids.type === 'fragment') {

            // If it was dropped onto a fragment, then we just take that fragment's parent as the target
            // Fragments can only be children of snips or chapters

            const fragmentParent = await outlineView.getTreeElementByUri(dropped.data.ids.parentUri);
            if (!fragmentParent) return
            
            finalParentNode = fragmentParent.data as SnipNode | ChapterNode;
        }
        else if (dropped.data.ids.type === 'container') {

            // For chapters container, assume the user is dropping data for creating a new chapter
            // In which case we can just create a new chapter node and drop the text inside of there
            if (compareFsPath(dropped.data.ids.uri, this.workspace.chaptersFolder)) {
                const chapterUri = await outlineView.newChapter(undefined, {
                    skipFragment: true,
                    defaultName: newDirectoryTitle + " (Chapter)",
                    preventRefresh: true,
                });
                if (!chapterUri) return;

                const chapter = await outlineView.getTreeElementByUri(chapterUri);
                if (!chapter) return;

                finalParentNode = chapter.data as ChapterNode;
            }
            // The only containers in the project are the chapters container or a snips container
            // So, if it's not the chapters container, we can create a new snip at the dropped 
            //        container node and use that as the parent
            else {
                const snipUri = await outlineView.newSnip(dropped, {
                    skipFragment: true,
                    defaultName: newDirectoryTitle,
                    preventRefresh: true,
                });
                if (!snipUri) return;

                const snip = await outlineView.getTreeElementByUri(snipUri);
                if (!snip) return;

                finalParentNode = snip.data as SnipNode;
            }
        }
        else if (dropped.data.ids.type === 'root') {

            // If dropped into the root, just create a new snip container in the work snips folder
            //        for the dropped fragments
            const workSnips = rootNode.snips;
            const snipUri = await outlineView.newSnip(workSnips, {
                skipFragment: true,
                defaultName: newDirectoryTitle,
                preventRefresh: true,
            });
            if (!snipUri) return;

            const snip = await outlineView.getTreeElementByUri(snipUri);
            if (!snip) return;

            finalParentNode = snip.data as SnipNode;
        }
        else /* dropped.data.ids.type === 'chapter' || dropped.data.ids.type === 'snip' */ {
            finalParentNode = dropped.data as SnipNode | ChapterNode;
        }

        let contents: OutlineNode[];
        if ("contents" in finalParentNode) {
            contents = finalParentNode.contents;
        }
        else {
            contents = finalParentNode.textData;
        }

        return this.importDroppedFragmentDocumentIntoOutline(
            "Outline", docs, 
            finalParentNode.ids.uri, finalParentNode.ids.type, contents
        );
    }

    
    public async handleScratchPadDrop (docs: vscode.Uri[]) {
        return this.importDroppedFragmentDocumentIntoOutline(
            'ScratchPad', docs, 
            ScratchPadView.scratchPadContainerUri, "snip",
            Extension.scratchPadView.rootNodes
        );
    }

    // Why the parameters of this function are weird:
    //        This function handles imports for dropped fragment data for both the scratch pad view and the outline view
    //            but the scratch pad view is strange because you only ever insert data into the `rootNodes` array,
    //            whereas you NEVER insert data into `rootNodes` for the OutlineView
    //        So, instead of inserting into an OutlineNode or a rootNode array, just take a generic array of OutlineNodes
    //            and insert into that
    //        In the same vein, just take a parent uri and type instead of a parent node 
    private async importDroppedFragmentDocumentIntoOutline (
        source: "Outline" | "ScratchPad",
        docs: vscode.Uri[],
        parentUri: vscode.Uri,
        parentType: Ids['type'],
        parentContents: OutlineNode[],
    ) {

        const fileNames: string[] = [];
        const exts = new Set<string>();

        for (let index = 0; index < docs.length; index++) {
            const doc = docs[index];
            const filename = vscodeUris.Utils.basename(doc);
            fileNames.push(filename);
            exts.add(vscodeUris.Utils.extname(doc));
        }

        const response = await vscode.window.showInformationMessage(`Import '${fileNames.join("', '")}' into workspace?`, {
            modal: true,
            detail: `${docs.length} new '${[...exts].join("', '")}' file(s) added to the ${source} folder.  Would you like to import them into your project?`
        }, 'Import');
        if (response !== 'Import') return;

        
        const parentDotConfigUri = vscode.Uri.joinPath(parentUri, '.config');
        const parentDotConfig = await readDotConfig(parentDotConfigUri);
        if (!parentDotConfig) return;

        const fsOperations: {
            operation: "copy" | "move",
            source: vscode.Uri,
            dest: vscode.Uri
        }[] = [];

        const openDocuments: vscode.Uri[] = [];

        for (let idx = 0; idx < docs.length; idx++) {
            const originalUri = docs[idx];
            const fileName = fileNames[idx];
            const ext = vscodeUris.Utils.extname(originalUri);

            let finalUri: vscode.Uri = originalUri;

            // If the document came from a location outside of the parent folder, we need to either copy it or move it to
            //        the parent folder to keep the Outline integrity intact
            if (!isSubdirectory(originalUri, parentUri)) {

                // Don't bother gemerating a new file name for this
                // User will expect dropped / imported document to have the same name as the original
                finalUri = vscode.Uri.joinPath(
                    parentUri,
                    fileName
                );

                // If the document is not currently in the destination folder, 
                //         BUT it IS under the chapters or snips folder, then we MOVE
                //        the document from where it is now into the destination folder
                if (isSubdirectory(originalUri, this.workspace.chaptersFolder) || isSubdirectory(originalUri, this.workspace.workSnipsFolder)
                ) {
                    fsOperations.push({
                        operation: "move",
                        dest: finalUri,
                        source: originalUri,
                    });
                }
                // Otherwise, it's coming from outside of WTANIWE's domain, and we don't
                //        want to bother it.  COPY is from the source to the final folder
                else {
                    fsOperations.push({
                        operation: "copy",
                        dest: finalUri,
                        source: originalUri,
                    });
                }
            }

            // Generate internal data for the added FragmentNode
            
            // Get the fragment number for this fragment
            const latestFragmentNumber = getLatestOrdering(parentDotConfig);
            const newFragmentNumber = latestFragmentNumber + 1;
            
            const title = `${fileName.replace(ext, "")} (Dropped ${getDateString()})`;
            const fragment: FragmentNode = {
                ids: {
                    display: title,
                    fileName: fileName,
                    ordering: newFragmentNumber,
                    parentTypeId: parentType,
                    parentUri: parentUri,
                    type: 'fragment',
                    relativePath: '/',
                    uri: finalUri
                },
                md: ''
            };
        
            // Add node data to parent container
            const fragmentNode = new OutlineNode(fragment);
            parentContents.push(fragmentNode);
        
            // Update dot config
            parentDotConfig[fileName] = {
                ordering: newFragmentNumber,
                title: title
            }

            openDocuments.push(finalUri);
        }

        
        if (fsOperations.length > 0) {
            // Wait until after all the internal rootNodes array is updated before copying the content over
            // To prevent the file system watcher from triggering again
            await Promise.all(fsOperations.map(({ operation, source, dest }) => {
                if (operation === 'move') {
                    return vscode.workspace.fs.rename(source, dest);
                }
                else if (operation === 'copy') {
                    return vscode.workspace.fs.copy(source, dest);
                }
            }))
        }

        // Once all the updates have been written to the dot config, we can finally write it to disk
        await writeDotConfig(parentDotConfigUri, parentDotConfig);

        if (source === 'Outline') {

            // Consequence of generic function, have to requery for the OutlineNode parent so we can refresh it:
            const outlineView = Extension.outlineView;
            const parent = await outlineView.getTreeElementByUri(parentUri);
            if (!parent) return;
            outlineView.refresh(false, [ parent ]);
        }
        else {
            // Just refresh the whole scratch pad view like normal
            Extension.scratchPadView.refresh(false, []);
        }

        for (const openDoc of openDocuments) {
            await showTextDocumentWithPreview(openDoc);
        }
    } 

    public importDroppedFolder (folderUris: vscode.Uri | vscode.Uri[], droppedSourceInfo?: DroppedSourceInfo) {
        const targets: vscode.Uri[] = [];
        if (!Array.isArray(folderUris)) {
            folderUris = [ folderUris ];
        }
        for (const uri of folderUris) {
            targets.push(...this.allDocs.filter(file => file.fsPath.includes(uri.fsPath + sep) && file.fsPath !== uri.fsPath));    
        }
        if (targets.length === 0) return;
        new ImportForm(this.context.extensionUri, this.context, targets, droppedSourceInfo);
    }

    registerCommands() {
        
        // Open import form
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.openImportWindow', () => {
            new ImportForm(this.context.extensionUri, this.context, this.allDocs);
        }));
        
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importFile', (uri: vscode.Uri) => {
            new ImportForm(this.context.extensionUri, this.context, [ uri ]);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importFolder', this.importDroppedFolder.bind(this)));
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
            Extension.openImportsIntro();
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

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importDroppedDocuments', this.importDroppedDocuments.bind(this)));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importScratchPadDropped', this.handleScratchPadDrop.bind(this)));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.import.fileExplorer.importDroppedFragmentDocuments', this.importDroppedFragmentDocuments.bind(this)));
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

        // TODO: if you ever want to write code to intercept dropped documents and paste the content into the current file
        // TODO: IMO, this is unnecessary and confusing, but may come back to it anyways
        // const wtSelector: readonly vscode.DocumentFilter[] = this.workspace.importFileTypes.map(fileType => __<vscode.DocumentFilter>({
        //     language: fileType
        // }));
        // context.subscriptions.push(vscode.languages.registerDocumentDropEditProvider(wtSelector, documentDropProvider));

        // Collect all non-wt, non-md importable file types and join on commas -- to be used in glob patter below
        const importableFileExtensions = workspace.importFileTypes
            .filter(importExt => importExt.toLocaleLowerCase() !== 'wt' && importExt.toLocaleLowerCase() !== 'md')
            .join(',');

        // Create a file system watcher that watches for all the importable file types being placed in the data folder
        //        and will trigger a function when one is created
        const importWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(Extension.rootPath, `data/{chapters,snips}/**/*.{${importableFileExtensions}}`),
            false,             // do not ignore create events
            true,            // ignore change events
            true,             // ignore delete events
        );
        
        importWatcher.onDidCreate(async (newDoc: vscode.Uri) => {
            const dirname = vscodeUris.Utils.dirname(newDoc);
            const insertedNode = await Extension.outlineView.getTreeElementByUri(dirname);
            if (!insertedNode) return;
            this.importDroppedDocuments([ newDoc ], insertedNode, false);
        });

        // Create a file system watcher that watches specifically for fragment file types being dropped into the file tree
        const fragmentDropWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(Extension.rootPath, `data/{chapters,snips,scratchPad}/**/*.{wt,md}`),
            false,             // do not ignore create events
            true,            // ignore change events
            true,             // ignore delete events
        );
        
        fragmentDropWatcher.onDidCreate(async (newDoc: vscode.Uri) => {

            // First, make sure this `onDidCreate` call is not being triggered by a new document being 
            //        created by WTANIWE itself
            // The easies way to do so is to just do a vague node search for this uri
            // If it's tracked by any of the components of WTANIWE, we know it was created by the extension,
            //        not the user and we can exit early
            const node = await vagueNodeSearch(newDoc);
            if (node.source !== null) {
                return;
            }

            // The sctatch pad view is a little strange because we insert directly into `rootNodes` array instead
            //        of into the child of another OutlineNode
            // So direct all updates to the scratch pad view to a special function
            const parentUri = vscodeUris.Utils.dirname(newDoc);
            if (compareFsPath(parentUri, this.workspace.scratchPadFolder)) {
                return this.handleScratchPadDrop([ newDoc ]);
            }

            // Otherwise, get the parent node of the new document from the OutlineView (it must be from the outline view
            //        because the glob pattern above selects only OutlineView + ScratchPadView paths) and attempt
            //        to insert the fragment data into that OutlineNode
            const parentNode = await vagueNodeSearch(newDoc);
            if (parentNode.node === null || parentNode.source !== 'outline') return;
            return this.importDroppedFragmentDocuments([ newDoc ], parentNode.node);
        });


        context.subscriptions.push(importWatcher);
        this.registerCommands();
    }
}