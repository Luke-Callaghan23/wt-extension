/* eslint-disable curly */
import * as vscode from 'vscode';
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from './../outline/nodes_impl/outlineNode';
import { OutlineView } from './../outline/outlineView';
import * as console from './vsconsole';
import * as extension from './../extension';
import { Packageable } from './../packageable';
import { TabLabels } from './../tabLabels/tabLabels';
import { Workspace } from './../workspace/workspaceClass';
import { RecyclingBinView } from './../recyclingBin/recyclingBinView';
import { ScratchPadView } from './../scratchPad/scratchPadView';
import { NotebookPanel } from '../notebook/notebookPanel';
import { getFsPathKey, getRelativePath, setFsPathKey, vagueNodeSearch } from './../miscTools/help';
import { BounceOnIt } from './bounceOnIt';

class DebouncedTreeRefresh extends BounceOnIt<[vscode.TextDocument]> {
    // One update every second
    private constructor() { super(1000); }
    
    protected async debouncedUpdate(cancellationToken: vscode.CancellationToken, document: vscode.TextDocument): Promise<void> {
        extension.ExtensionGlobals.outlineView.getTreeElementByUri(document.uri).then((node) => {
            if (!node) return;
            extension.ExtensionGlobals.outlineView.refresh(false, [node], true);
        });
    }
    
    private static instance = new this();
    public static updateTreeView (document: vscode.TextDocument) {
        this.instance.triggerDebounce(document);
    }
}

export class FileAccessManager implements Packageable<"wt.fileAccesses.positions"> {

    static lastAccessedFragment: vscode.Uri | undefined;
    static lastAccessedChapter: vscode.Uri | undefined;
    static lastAccessedSnip: vscode.Uri | undefined;

    // Logs the latest accessed fragment for a given uri
    private static latestFragmentForUri: { [index: string]: vscode.Uri };

    private static positions: { [ index: string ]: vscode.Selection };

    static getPosition (uri: vscode.Uri): vscode.Selection | null {
        const relativePath = getRelativePath(uri);
        if (relativePath in FileAccessManager.positions) {
            return FileAccessManager.positions[relativePath];
        }
        return null;
    }

    static async documentOpened (openedUri: vscode.Uri, view?: OutlineView): Promise<void> {

        // Mark the last opened document for each parental node as the document which was just opened
        let currentUri: vscode.Uri | undefined = openedUri;
        let { node, source } = await vagueNodeSearch (openedUri);
        if (!node || !source) return;

        if (source !== 'outline') {
            TabLabels.assignNamesForOpenTabs();
            return;
        }

        let currentNode: OutlineNode | null = node as OutlineNode;
        while (currentUri && currentNode) {
            // Mark latest accessed chapter or snip if the current node is a chapter or snip
            if (currentNode.data.ids.type === 'chapter') {
                FileAccessManager.lastAccessedChapter = currentUri;
            }
            else if (currentNode.data.ids.type === 'snip') {
                FileAccessManager.lastAccessedSnip = currentUri;
            }

            // Set the latest accessed fragment for the current uri to the fragment document which was just opened
            setFsPathKey<vscode.Uri>(currentUri, openedUri, FileAccessManager.latestFragmentForUri);

            if (currentNode.data.ids.type === 'root') {
                break;
            }
            
            // Traverse upwards
            currentUri = currentNode.data.ids.parentUri;
            currentNode = await extension.ExtensionGlobals.outlineView.getTreeElementByUri(currentUri);
        }

        // Also update the latest file access
        FileAccessManager.lastAccessedFragment = openedUri;

        TabLabels.assignNamesForOpenTabs();
    }

    static lastAccessedFragmentForUri (targetUri: vscode.Uri): vscode.Uri | undefined {
        return getFsPathKey<vscode.Uri>(targetUri, FileAccessManager.latestFragmentForUri);
    }

    static lastEditor: vscode.TextEditor | undefined = undefined;
    static savePosition (editor: vscode.TextEditor | undefined) {
        // For some reason, this gets fired twice, so this safeguard is needed
        // !lastEditor won't work, need to do it like this
        //      source: trust me bro
        if (FileAccessManager.lastEditor) {
            const document = FileAccessManager.lastEditor.document;
            if (!document) return;

            const lastUri = document.uri;
            const usableUri = lastUri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
            if (usableUri.endsWith('.wt') || usableUri.endsWith('.wtnote')) {
                FileAccessManager.positions[usableUri] = FileAccessManager.lastEditor.selection;
            }
        }
        FileAccessManager.lastEditor = editor;
    }

    private static lastContextUpdate: number = Date.now();
    static registerCommands (context: vscode.ExtensionContext): void {


        const cb = async (editor: vscode.TextEditor | vscode.NotebookEditor | undefined) => {
            setTimeout(() => {
                if (editor && 'notebook' in editor) {
                    FileAccessManager.documentOpened(editor.notebook.uri);
                    return;
                }

                if (editor && editor.document) {
                    FileAccessManager.documentOpened(editor.document.uri);
                }
                FileAccessManager.savePosition(editor);
                if (Date.now() - FileAccessManager.lastContextUpdate > 10 * 1000) {
                    Workspace.packageContextItems();
                    FileAccessManager.lastContextUpdate = Date.now();
                }
            }, 0);
        };

        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(cb));
        context.subscriptions.push(vscode.window.onDidChangeActiveNotebookEditor(cb));
        context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
            cb(vscode.window.activeTextEditor);
            
            // Update the fragment in the outline view.  Forces a refresh for the preview on fragment nodes
            // Since this is a fragment node with no children, only one node should be updated and shouldn't be too intensive
            // Still, debounce it so that if the user is spam saving, we do not spam update the tree view
            DebouncedTreeRefresh.updateTreeView(document);
        }));
        context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => cb(e.textEditor)));
    }

    
    static async initialize (context: vscode.ExtensionContext) {

        FileAccessManager.latestFragmentForUri = {};

        // Collect set of all opened tabs
        const tabGroups = vscode.window.tabGroups.all;
        const allOpenedTabs = tabGroups.map(tg => tg.tabs).flat();

        // Collect set of all opened tabs
        const validatedOpenedTabs: vscode.Uri[] = [];
        for (const tab of allOpenedTabs) {
            // If `tab.input` is not formatted as expected, then skip the uri
            // Expected format is `{ uri: vscode.Uri }`
            const tabUri = (tab.input as { uri?: vscode.Uri })?.uri;
            if (!tabUri) continue;
            
            // If the uri cannot be found inside of the outline view's structure,
            //      then skip the uri
            const { node, source } = await vagueNodeSearch(tabUri);
            if (!node || !source) continue;

            // Otherwise, the uri is validated
            validatedOpenedTabs.push(tabUri);
        }

        // Get stats for all the opened uris in the editor
        type UriStats = {
            uri: vscode.Uri,
            stats: vscode.FileStat
        }
        const stats: UriStats[] = await Promise.all(validatedOpenedTabs.map(openedUri => {
            return vscode.workspace.fs.stat(openedUri).then(stats => {
                return {
                    uri: openedUri,
                    stats: stats
                };
            });
        }));

        // Sort the opened uris by their last modified time, ascending
        const sortedUris = stats
            .sort((a, b) => a.stats.mtime - b.stats.mtime)
            .map(uriStats => uriStats.uri);

        // Call document opened for each of the opened fragments in ascending
        //      order to simulate as if all the documents were opened sequentially
        for (const opened of sortedUris) {
            await this.documentOpened(opened, extension.ExtensionGlobals.outlineView);
        }

        FileAccessManager.positions = {};

        // Register the commands associated with the file access manager
        FileAccessManager.registerCommands(context);
    }

    
    getPackageItems() {
        const positionPackage: { [index: string]: any } = {};
        try {
            Object.entries(FileAccessManager.positions).forEach(([ uri, select ]) => {
                if (!select) return;
                if (!uri) return;
                const anchor = select.anchor;
                const anchorLine = anchor.line;
                const anchorChar = anchor.character;
    
                const active = select.active;
                const activeLine = active.line;
                const activeChar = active.character;
    
                positionPackage[uri] = {
                    anchorLine, anchorChar,
                    activeLine, activeChar
                };
            });
        }
        catch (e) {
            console.log(`${e}`);
        }
        return {
            "wt.fileAccesses.positions": positionPackage
        };
    }
}