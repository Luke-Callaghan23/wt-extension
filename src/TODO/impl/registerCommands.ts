import * as vscode from 'vscode';
import { TODO, TODOsView } from '../TODOsView';
import { TODONode } from '../node';
import { OutlineNode } from '../../outline/nodes_impl/outlineNode';
import { ChapterNode, ContainerNode, FragmentNode, RootNode, SnipNode } from '../../outlineProvider/fsNodes';
import { DiskContextType } from '../../workspace/workspaceClass';
import { showTextDocumentWithPreview } from '../../miscTools/help';
import { TimedView } from '../../timedView';

export function registerCommands(this: TODOsView) {
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.todo.openFile', async (resourceUri: vscode.Uri, todoData: TODO) => {
        // Create a range object representing where the TODO lies on the document
        const textDocumentRange = new vscode.Range (
            todoData.rowStart,        // start line
            todoData.colStart,        // start character
            todoData.rowEnd,        // end line
            todoData.colEnd,        // end character
        );

        // Open the document
        await showTextDocumentWithPreview(resourceUri, { selection: textDocumentRange });
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand('wt.todo.refresh', this.refreshView.bind(this)));
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.todo.getView', () => this));
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.todo.updateTree', this.updateTree.bind(this)));

    this.context.subscriptions.push(vscode.commands.registerCommand('wt.todo.help', () => {
        vscode.window.showInformationMessage(`TODOs`, {
            modal: true,
            detail: `The TODO panel is an area that logs all areas you've marked as 'to do' in your work.  The default (and only (for now)) way to mark a TODO in your work is to enclose the area you want to mark with square brackets '[]'`
        }, 'Okay');
    }));


    this.view.onDidChangeVisibility((ev) => {
        if (ev.visible) {
            return this.refreshView();
        }
    });
}