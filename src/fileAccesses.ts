/* eslint-disable curly */
import * as vscode from 'vscode';
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from './outline/node';
import { OutlineView } from './outline/outlineView';
import * as console from './vsconsole';
import * as extension from './extension';
import { Packageable } from './packageable';

export class FileAccessManager implements Packageable {

    static lastAccessedFragment: vscode.Uri | undefined;

    // container uri -> uri of last accessed fragment of that container
    // private static fileAccesses: { [ index: string ]: vscode.Uri };

    // Logs the latest accessed fragment for a given uri
    private static latestFragmentForUri: { [index: string]: vscode.Uri };

    private static positions: { [ index: string ]: vscode.Selection };

    static async documentOpened (openedUri: vscode.Uri, view?: OutlineView): Promise<void> {
        
        let outlineView: OutlineView;
        if (!view) {
            // Get the outline view for querying nodes, if not provided by caller
            outlineView = await vscode.commands.executeCommand('wt.outline.getOutline');
        }
        else {
            outlineView = view;
        }


        // Traverse upwards from the opened fragment until we find a node whose type is container
        // const openedUri = document.uri;
        // let uri: vscode.Uri | undefined = document.uri;
		// let node: OutlineNode | null = await outlineView._getTreeElementByUri(document.uri);
		// while (node && uri) {
		// 	// Break once the current node is a container
		// 	if (node.data.ids.type === 'container') {
		// 		break;
		// 	}

		// 	// Otherwise, traverse upwards
		// 	const parentId = node.data.ids.parentUri;
		// 	node = await outlineView._getTreeElementByUri(parentId);
		// 	uri = node?.getUri();
		// }
        // if (node?.data.ids.type !== 'container') return;

        // Mark the last opened document for each parental node as the document which was just opened
        let currentUri: vscode.Uri | undefined = openedUri;
        let currentNode : OutlineNode | null = await outlineView._getTreeElementByUri(openedUri);
        while (currentUri && currentNode) {
            

            // Set the latest accessed fragment for the current uri to the fragment document which was just opened
            FileAccessManager.latestFragmentForUri[currentUri.fsPath] = openedUri;

            if (currentNode.data.ids.type === 'root') {
                break;
            }
            
            // Traverse upwards
            currentUri = currentNode.data.ids.parentUri;
            currentNode = await outlineView._getTreeElementByUri(currentUri);
        }

        // // Get the uri of the container
        // const containerNode: OutlineNode = node;
        // const containerUri = containerNode.getUri();
        // const containerUsableUri = containerUri.fsPath.replace(extension.rootPath.fsPath, '');

        // // Set the latest file access for the container of the opened uri to the opened uri
        // FileAccessManager.fileAccesses[containerUsableUri] = openedUri;

        console.log(openedUri)

        // Also update the latest file access
        FileAccessManager.lastAccessedFragment = openedUri;
    }

    // Gets the last accessed document inside of a container
    // If none of a container's 
    // static containerLastAccessedDocument (container: OutlineNode): vscode.Uri {
        
    //     const containerUri = container.getUri();
    //     const containerUsableUri = containerUri.fsPath.replace(extension.rootPath.fsPath, '');

    //     // First, check if there is a log for this container 
    //     const lastAccess: vscode.Uri | undefined = FileAccessManager.fileAccesses[containerUsableUri];
    //     if (lastAccess !== undefined) {
    //         // If there is a logged access for the target container, simply return that access
    //         return lastAccess;
    //     }

    //     // If there has been no logged accesses for the target container, then use the latest fragment of the latest item
    //     //      in the container
    //     const containerNode: ContainerNode = container.data as ContainerNode;
    //     const content: OutlineNode[] = containerNode.contents;
    //     content.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
        
    //     // Content always holds ChapterNodes or SnipNodes -- both of which have .textData arrays
    //     const lastContent: (ChapterNode | SnipNode) = content[content.length - 1].data as (ChapterNode | SnipNode);
    //     const textFragments: OutlineNode[] = lastContent.textData;
    //     textFragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

    //     // Last fragment in the ordered list of fragments is the target
    //     const lastFragment: OutlineNode = textFragments[textFragments.length - 1];
    //     const fragmentUri = lastFragment.getUri();
        
    //     // Add the mapping from container uri to its last (ordered) fragment
    //     FileAccessManager.fileAccesses[containerUsableUri] = fragmentUri;
    //     return fragmentUri;
    // }

    static lastAccessedFragmentForUri (targetUri: vscode.Uri): vscode.Uri {
        return FileAccessManager.latestFragmentForUri[targetUri.fsPath];
    }

    static lastEditor: vscode.TextEditor | undefined = undefined;
    static savePosition (editor: vscode.TextEditor | undefined) {
        // For some reason, this gets fired twice, so this safeguard is needed
            // !lastEditor won't work, need to do it like this
            // source: trust me bro
            if (FileAccessManager.lastEditor) {
                const document = FileAccessManager.lastEditor.document;
                if (!document) return;

                const lastUri = document.uri;
                const usableUri = lastUri.fsPath.replace(extension.rootPath.fsPath, '');
                FileAccessManager.positions[usableUri] = FileAccessManager.lastEditor.selection;
            }
            FileAccessManager.lastEditor = editor;
    }

    static registerCommands (): void {
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor && editor.document) {
                FileAccessManager.documentOpened(editor.document.uri);
            }
            FileAccessManager.savePosition(editor);
        });
    }

    static async initialize () {

        FileAccessManager.latestFragmentForUri = {};
        const outlineView: OutlineView = await vscode.commands.executeCommand('wt.outline.getOutline');

        // Collect set of all opened tabs
        const tabGroups = vscode.window.tabGroups.all;
        const allOpenedTabs = tabGroups.map(tg => tg.tabs).flat();

        // Collect set of all opened tabs
        const validatedOpenedTabs: vscode.Uri[] = [];
        for (const tab of allOpenedTabs) {
            // If `tab.input` is not formatted as expected, then skip the uri
            // Expected format is `{ uri: vscode.Uri }`
            const tabUri = (tab.input as { uri?: vscode.Uri }).uri;
            if (!tabUri) continue;
            
            // If the uri cannot be found inside of the outline view's structure,
            //      then skip the uri
            const node: OutlineNode | undefined | null = await outlineView._getTreeElementByUri(tabUri);
            if (!node) continue;

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
            await this.documentOpened(opened, outlineView);
        }


        // FileAccessManager.fileAccesses = {};

        // // On startup, log the accesses for all open tabs
        
        
        // // Log each of the opened editors
        // const editors: vscode.TextEditor[] = [...vscode.window.visibleTextEditors];
        // for (const editor of editors) {
        //     await FileAccessManager.documentOpened(editor.document, outlineView);
        // }

        // FileAccessManager.lastAccess = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : undefined;
        // FileAccessManager.lastEditor = vscode.window.activeTextEditor;
        FileAccessManager.positions = {};

        // Register the commands associated with the file access manager
        FileAccessManager.registerCommands();
    }

    
    getPackageItems(): { [index: string]: any; } {
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