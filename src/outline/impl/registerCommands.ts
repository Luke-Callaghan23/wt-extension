import * as vscode from 'vscode';
import { OutlineView } from "../outlineView";
import { ContainerNode, OutlineNode, RootNode } from '../node';
import * as extension from '../../extension';
import { CopiedSelection } from './copyPaste';


// Register all the commands needed for the outline view to work
export function registerCommands (this: OutlineView) {
    vscode.commands.registerCommand('wt.outline.openFile', (resource) => {
        vscode.window.showTextDocument(resource, { preserveFocus: true });
    });
    vscode.commands.registerCommand('wt.outline.refresh', 
        // Reload command has ambiguous changes and should include a full reload from disk
        (resource: OutlineNode) => this.refresh(true)
    );
    vscode.commands.registerCommand('wt.outline.renameFile', () => {
        if (this.view.selection.length > 1) return;
        this.renameResource();
    });

    vscode.commands.registerCommand("wt.outline.newChapter", (resource) => {
        this.newChapter(resource);
    });
    vscode.commands.registerCommand("wt.outline.newSnip", (resource) => {
        if (!resource && this.view.selection.length > 0) {
            // If the resource of the command is undefined, but there are selected items in the view
            //      then use the first selected item as the resource
            resource = this.view.selection[0];
        }
        this.newSnip(resource);
    });
    vscode.commands.registerCommand("wt.outline.newFragment", (resource) => {
        if (!resource && this.view.selection.length > 0) {
            // If the resource of the command is undefined, but there are selected items in the view
            //      then use the first selected item as the resource
            resource = this.view.selection[0];
        }
        this.newFragment(resource);
    });

    vscode.commands.registerCommand("wt.outline.moveUp", (resource) => this.moveUp(resource));
    vscode.commands.registerCommand("wt.outline.moveDown", (resource) => this.moveDown(resource));
    
    vscode.commands.registerCommand("wt.outline.removeResource", (resource) => this.removeResource(resource));

    vscode.commands.registerCommand("wt.outline.collectChapterUris", () => {
        const root: RootNode = this.tree.data as RootNode;
        const chaptersContainer: ContainerNode = root.chapters.data as ContainerNode;
        return chaptersContainer.contents.map(c => {
            const title = c.data.ids.display;
            const uri = c.getUri().fsPath.split(extension.rootPath.fsPath)[1];
            return [uri, title];
        });
    });

    vscode.commands.registerCommand('wt.outline.help', () => {
        vscode.window.showInformationMessage(`Outline View`, {
            modal: true,
            detail: `The outline view gives a general outline of the structure of your project.  It shows all the chapters, chapter fragments, chapter snips, chapter snip fragments, work snips, and work snip fragments of your entire work.  For more information hit 'Ctrl+Shift+P' and type 'wt:help' into the search bar for more information.`
        }, 'Okay');
    });

    vscode.commands.registerCommand('wt.outline.getOutline', () => this);

    vscode.commands.registerCommand('wt.outline.copyItems', () => {
        // Ensure that there are selected items and then call the `copy` method
        const selected = this.view.selection;
        if (selected.length === 0) return;
        this.copy(selected);
    });

    vscode.commands.registerCommand('wt.outline.pasteItems', async () => {
        
        // Ensure that there are items to paste currently stored in workspace state
        const copied: CopiedSelection | undefined = this.context.workspaceState.get<CopiedSelection>('copied');
        if (!copied) return;

        // Find all copied items that still exist in the tree in the same location
        const copies: (OutlineNode | undefined | null)[] = await Promise.all(copied.nodes.map(copy => {
            return this._getTreeElementByUri(copy.data.ids.uri) as Promise<OutlineNode | null | undefined>;
        }));
        const validCopiedNodes = copies.filter(copy => copy) as OutlineNode[];

        // Ensure that there still exists some valid nodes to paste
        if (validCopiedNodes.length === 0) return;

        // Create a new copied object for the copied data
        const validCopied: CopiedSelection = validCopiedNodes.length === copied.nodes.length
            ? copied : {
                count: validCopiedNodes.length,
                nodes: validCopiedNodes,
                type: copied.type
            };

        // If there is no selected detination for the paste in the outline
        //      view, then default to using the tree as the paste destination
        let selected = this.view.selection;
        if (selected.length === 0) selected = [ this.tree ];

        const pasteLog: { [index: string]: 1 } = {};

        const copiedCount = validCopied.count;
        let pastedCount = 0;
        let pasteErrors = 0;

        // Now, for each node currently selected in the outline view, paste all
        //      copied content into that destination
        for (const destination of selected) {
            const pasted = await this.paste(destination, validCopied, pasteLog);
            if (!pasted) {
                vscode.window.showWarningMessage(`WARN: Skipped paste to '${destination.data.ids.display}': unknown error`);
                pasteErrors++;
                continue;
            }

            // Add the destination of the laste paste into the paste log
            pasteLog[pasted.fsPath] = 1;
            pastedCount += 1;
        }

        if (pasteErrors === 0) {
            vscode.window.showInformationMessage(`INFO: Successfully pasted (${copiedCount}) resources into (${pastedCount}) destinations`);
        }
        else if (pastedCount > 0) {
            vscode.window.showWarningMessage(`WARN: Pasted (${copiedCount}) resources to only (${pastedCount}) of (${pasteErrors + pastedCount}) destinations`)
        }
        else {
            vscode.window.showErrorMessage(`ERROR: Pasted to 0 destination`)
        }
    });
}
