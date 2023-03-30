import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';

export class CompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {

    }

    async provideCompletionItems(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken, 
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionList<vscode.CompletionItem> | vscode.CompletionItem[]> {

    }
}