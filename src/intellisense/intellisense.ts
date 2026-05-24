import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../miscTools/vsconsole';
import { CompletionItemProvider } from './synonyms/completionItemProvider';
import { HoverProvider } from './synonyms/hoverProvider';
import { CodeActionProvider } from './synonyms/codeActionProvider';
import { PersonalDictionary } from './spellcheck/personalDictionary';
import { SynonymProviderType, SynonymsProvider } from './synonymsProvider/provideSynonyms';

export class SynonymsIntellisense {
    private _currentProvider: SynonymProviderType;

    public getCurrentSynonymsProvider (): SynonymProviderType {
        return this._currentProvider;
    }
    
    public isWordHippo (): boolean {
        return this._currentProvider === 'wh';
    }

    public setIsWordHippo (isWordHippo: boolean) {
        if (isWordHippo) {
            this._currentProvider = 'wh';
        }
        else {
            this._currentProvider = 'synonymsApi';
        }
    }

    public toggleProvider (): SynonymProviderType {
        if (this._currentProvider === 'wh') {
            this._currentProvider = 'synonymsApi';
        }
        else {
            this._currentProvider = 'wh';
        }
        return this._currentProvider;
    }

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private personalDictionary: PersonalDictionary,
        private useWordHippo: boolean,
    ) {
        this._currentProvider = useWordHippo ? 'wh' : 'synonymsApi';
    }

    public async init () {
        const wtSelector: readonly vscode.DocumentFilter[] = [ 
            { language: 'wt' },
            { language: 'markdown' },
            { language: 'wtnote' },
        ];

        await SynonymsProvider.init(this.workspace);
        this.context.subscriptions.push(vscode.languages.registerCompletionItemProvider (wtSelector, new CompletionItemProvider(this.context, this.workspace, this)));
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