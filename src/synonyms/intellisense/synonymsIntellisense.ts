import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { CompletionItemProvider } from './completionItemProvider';
import { HoverProvider } from './hoverProcider';
import { CodeActionProvider } from './codeActionProvider';

export class SynonymsIntellisense {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {
        const wtSelector: vscode.DocumentFilter = {
            language: 'wt',
            scheme: 'file'
        };
        vscode.languages.registerCompletionItemProvider (wtSelector, new CompletionItemProvider(context, workspace));
        vscode.languages.registerHoverProvider (wtSelector, new HoverProvider(context, workspace));
        vscode.languages.registerCodeActionsPProvider (wtSelector, new CodeActionProvider(context, workspace));


    }
}