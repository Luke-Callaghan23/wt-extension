import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../vsconsole';
import { CompletionItemProvider } from './synonyms/completionItemProvider';
import { HoverProvider } from './synonyms/hoverProvider';
import { CodeActionProvider } from './synonyms/codeActionProvider';
import { PersonalDictionary } from './spellcheck/personalDictionary';

export class SynonymsIntellisense {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        personalDictionary: PersonalDictionary
    ) {
        const wtSelector: vscode.DocumentFilter = <vscode.DocumentFilter>{
            language: 'wt'
        };
        vscode.languages.registerCompletionItemProvider (wtSelector, new CompletionItemProvider(context, workspace));
        vscode.languages.registerHoverProvider (wtSelector, new HoverProvider(context, workspace));
        vscode.languages.registerCodeActionsProvider (wtSelector, new CodeActionProvider(context, workspace, personalDictionary));
    
        this.registerCommands();
    }

    registerCommands() {
        vscode.commands.registerCommand('wt.synonyms.getSynonyms', () => {
            console.log('awdawdw');
        })
    }
}