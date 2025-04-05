import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../miscTools/vsconsole';
import { CompletionItemProvider } from './synonyms/completionItemProvider';
import { HoverProvider } from './synonyms/hoverProvider';
import { CodeActionProvider } from './synonyms/codeActionProvider';
import { PersonalDictionary } from './spellcheck/personalDictionary';
import { SynonymsProvider } from './synonymsProvider/provideSynonyms';

export class SynonymsIntellisense {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        personalDictionary: PersonalDictionary,
        useWordHippo: boolean,
    ) {
        const wtSelector: vscode.DocumentFilter = <vscode.DocumentFilter>{
            language: 'wt'
        };
        SynonymsProvider.init(workspace).then(() => {
            this.context.subscriptions.push(vscode.languages.registerCompletionItemProvider (wtSelector, new CompletionItemProvider(context, workspace, useWordHippo)));
            this.context.subscriptions.push(vscode.languages.registerHoverProvider (wtSelector, new HoverProvider(context, workspace)));
            this.context.subscriptions.push(vscode.languages.registerCodeActionsProvider (wtSelector, new CodeActionProvider(context, workspace, personalDictionary)));
            this.registerCommands();
        });
    }

    registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.synonyms.getSynonyms', () => {
            // TODO    
        }));
    }
}