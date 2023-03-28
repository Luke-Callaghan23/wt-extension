import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { CompletionItemProvider } from './completionItemProvider';
import { HoverProvider } from './hoverProvider';
import { CodeActionProvider } from './codeActionProvider';

export class SynonymsIntellisense {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {
        const wtSelector: vscode.DocumentFilter = <vscode.DocumentFilter>{
            language: 'wt',
            scheme: 'file'
        };
        const hover = new HoverProvider(context, workspace);
        vscode.languages.registerCompletionItemProvider (wtSelector, new CompletionItemProvider(context, workspace, hover));
        vscode.languages.registerHoverProvider (wtSelector, hover);
        vscode.languages.registerCodeActionsProvider (wtSelector, new CodeActionProvider(context, workspace));
    }
}