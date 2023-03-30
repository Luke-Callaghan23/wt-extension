import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { getHoveredWord } from './common';

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
        const hoverPosition = getHoveredWord(document, position);
        if (!hoverPosition) return [];
        
        // Query the synonym api for the hovered word
        const response = await query(hoverPosition.text);
        if (!response) return [];

    }
}