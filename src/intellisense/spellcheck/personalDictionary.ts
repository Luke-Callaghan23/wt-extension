import * as vscode from 'vscode';
import { Packageable } from '../../packageable';
import { Workspace } from '../../workspace/workspaceClass';
import { Dict } from './dictionary';

export class PersonalDictionary implements Packageable<'wt.personalDictionary'> {
    private dict: Dict;

    getPackageItems() {
        return {
            'wt.personalDictionary': this.dict
        }
    }

    search (word: string): boolean {
        return this.dict[word] === 1;
    }

    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
    ) {
        const workspaceDict: Dict | undefined = context.workspaceState.get('wt.personalDictionary');
        this.dict = workspaceDict || {};
        this.registerCommands();
    }

    // Command for adding word to personal dictionary
    // Called from command pallette or quick pick menu (see: `CodeActionProvider`)
    async addWordCommand (word: string | undefined | null): Promise<void> {
        // The add word command can be called from the command pallette as well
        //      as from a quick pick menu
        // When called from quick pick, `word` will be defined, so use that
        if (!word) {
            // When called from command pallette, `word` won't be defined, so
            //      prompt the user for the word to add to the personal dictionary
            word = await vscode.window.showInputBox({
                placeHolder: 'supercalifragilisticexpialadocious',
                ignoreFocusOut: false,
                prompt: `Enter a word to add to your personal dictionary`,
                title: 'Add word to personal dictionary'
            });
            if (!word) return;
        }

        // Get lowercase word
        word = word.toLocaleLowerCase();
        
        // Add the word
        this.dict[word] = 1;
        vscode.commands.executeCommand('wt.timedViews.update');
        Workspace.forcePackaging(this.context, 'wt.personalDictionary', this.dict);
    }

    // Command for removing a word from the personal dictionary
    // Called from command pallette
    async removeWordCommand (): Promise<void> {
        // Show a quick pick for all the words currently in the personal dictionary
        const wordsInDict = Object.keys(this.dict).reverse();
        const remove: string | undefined = await vscode.window.showQuickPick(
            wordsInDict, 
            {
                ignoreFocusOut: false,
                title: 'Remove a word from your personal dictionary',
                canPickMany: false
            }
        );
        if (!remove) return;

        // Remove the word
        delete this.dict[remove];
        Workspace.forcePackaging(this.context, 'wt.personalDictionary', this.dict);
    }


    registerCommands () {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.personalDictionary.add', (word: string | undefined | null) => this.addWordCommand(word)));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.personalDictionary.remove', () => this.removeWordCommand()));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.personalDictionary.refresh", (refreshWith: { [index: string]: 1 }) => {
            this.dict = refreshWith;
        }));
    }
}