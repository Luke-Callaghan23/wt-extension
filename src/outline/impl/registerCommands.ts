import * as vscode from 'vscode';
import { OutlineView } from "../outlineView";
import { ContainerNode, OutlineNode, RootNode } from '../node';
import * as extension from '../../extension';


// Register all the commands needed for the outline view to work
export function registerCommands (this: OutlineView) {
    vscode.commands.registerCommand('wt.outline.openFile', (resource) => {
        vscode.window.showTextDocument(resource, { preserveFocus: true });
    });
    vscode.commands.registerCommand('wt.outline.refresh', (resource: OutlineNode) => this.refresh(this.tree));
    vscode.commands.registerCommand('wt.outline.renameFile', () => {
        if (this.view.selection.length > 1) return;
        this.renameResource();
    });

    vscode.commands.registerCommand("wt.outline.newChapter", (resource) => {
        this.newChapter(resource);
    });
    vscode.commands.registerCommand("wt.outline.newSnip", (resource) => {
        this.newSnip(resource);
    });
    vscode.commands.registerCommand("wt.outline.newFragment", (resource) => {
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
}
