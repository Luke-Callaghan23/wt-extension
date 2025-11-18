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
        private workspace: Workspace,
        private personalDictionary: PersonalDictionary,
        private useWordHippo: boolean,
    ) {
    }

    public async init () {
        const wtSelector: vscode.DocumentFilter = <vscode.DocumentFilter>{
            language: 'wt'
        };
        await SynonymsProvider.init(this.workspace);
        this.context.subscriptions.push(vscode.languages.registerCompletionItemProvider (wtSelector, new CompletionItemProvider(this.context, this.workspace, this.useWordHippo)));
        this.context.subscriptions.push(vscode.languages.registerHoverProvider (wtSelector, new HoverProvider(this.context, this.workspace)));
        this.context.subscriptions.push(vscode.languages.registerCodeActionsProvider (wtSelector, new CodeActionProvider(this.context, this.workspace, this.personalDictionary)));
        this.registerCommands();
    }

    registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.synonyms.getSynonyms', () => {
            // TODO    
        }));
    }
}