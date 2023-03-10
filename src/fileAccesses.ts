/* eslint-disable curly */
import * as vscode from 'vscode';
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from './outline/outlineNodes';
import { OutlineView } from './outline/outlineView';
import * as console from './vsconsole';


export class FileAccessManager {

    static lastAccess: vscode.Uri | undefined;

    // container uri -> uri of last accessed fragment of that container
    private static fileAccesses: { [ index: string ]: vscode.Uri };

    static async documentOpened (document: vscode.TextDocument, view?: OutlineView) {
        
        let outlineView: OutlineView;
        if (!view) {
            // Get the outline view for querying nodes, if not provided by caller
            outlineView = await vscode.commands.executeCommand('wt.outline.getOutline');
        }
        else {
            outlineView = view;
        }


        // Traverse upwards from the opened fragment until we find a node whose type is container
        const openedUri = document.uri;
        let uri: vscode.Uri | undefined = document.uri;
		let node: OutlineNode | undefined | null = await outlineView._getTreeElementByUri(document.uri);
		while (node && uri) {
			// Break once the current node is a container
			if (node.data.ids.type === 'container') {
				break;
			}

			// Otherwise, traverse upwards
			const parentId = node.data.ids.parentInternalId;
			node = await outlineView._getTreeElement(parentId);
			uri = node?.getUri();
		}
        if (node?.data.ids.type !== 'container') return;

        // Get the uri of the container
        const containerNode: OutlineNode = node;
        const containerUri = containerNode.getUri();

        // Set the latest file access for the container of the opened uri to the opened uri
        FileAccessManager.fileAccesses[containerUri.fsPath] = openedUri;

        // Also update the latest file access
        FileAccessManager.lastAccess = uri;
    }

    // Gets the last accessed document inside of a container
    // If none of a container's 
    static containerLastAccessedDocument (container: OutlineNode): vscode.Uri {
        
        const containerUri = container.getUri();
        
        // First, check if there is a log for this container 
        const lastAccess: vscode.Uri | undefined = FileAccessManager.fileAccesses[containerUri.fsPath];
        if (lastAccess !== undefined) {
            // If there is a logged access for the target container, simply return that access
            return lastAccess;
        }

        // If there has been no logged accesses for the target container, then use the latest fragment of the latest item
        //      in the container
        const containerNode: ContainerNode = container.data as ContainerNode;
        const content: OutlineNode[] = containerNode.contents;
        content.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
        
        // Content always holds ChapterNodes or SnipNodes -- both of which have .textData arrays
        const lastContent: (ChapterNode | SnipNode) = content[content.length - 1].data as (ChapterNode | SnipNode);
        const textFragments: OutlineNode[] = lastContent.textData;
        textFragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

        // Last fragment in the ordered list of fragments is the target
        const lastFragment: OutlineNode = textFragments[textFragments.length - 1];
        const fragmentUri = lastFragment.getUri();
        
        // Add the mapping from container uri to its last (ordered) fragment
        FileAccessManager.fileAccesses[containerUri.fsPath] = fragmentUri;
        return fragmentUri;
    }

    static registerCommands (): void {
        vscode.window.onDidChangeActiveTextEditor(editor => editor && editor.document && FileAccessManager.documentOpened(editor.document));
    }

    static async initialize () {
        FileAccessManager.fileAccesses = {};

        // On startup, log the accesses for all open tabs
        
        const outlineView: OutlineView = await vscode.commands.executeCommand('wt.outline.getOutline');
        
        // Log each of the opened editors
        const editors: vscode.TextEditor[] = [...vscode.window.visibleTextEditors];
        for (const editor of editors) {
            await FileAccessManager.documentOpened(editor.document, outlineView);
        }

        FileAccessManager.lastAccess = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : undefined;

        // Register the commands associated with the file access manager
        FileAccessManager.registerCommands();
    }
}