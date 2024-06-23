import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../vsconsole';
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
            vscode.languages.registerCompletionItemProvider (wtSelector, new CompletionItemProvider(context, workspace, useWordHippo));
            vscode.languages.registerHoverProvider (wtSelector, new HoverProvider(context, workspace));
            vscode.languages.registerCodeActionsProvider (wtSelector, new CodeActionProvider(context, workspace, personalDictionary));
            this.registerCommands();
        });
    }

    registerCommands() {
        vscode.commands.registerCommand('wt.synonyms.getSynonyms', () => {
            // TODO    
        })
    }
}