import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import { getHoveredWord } from '../intellisense/common';
import { __, getTextCapitalization } from '../miscTools/help';
import { ExtensionGlobals, globalWorkspace } from '../extension';
import { WordWatcher } from './wordWatcher';

export class WordWatcherCodeActionProvider implements vscode.CodeActionProvider {
    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private wordWatcher: WordWatcher,
    ) {

    }

    async provideCodeActions (
        document: vscode.TextDocument, 
        range: vscode.Range | vscode.Selection, 
        context: vscode.CodeActionContext, 
        token: vscode.CancellationToken
    ): Promise<(vscode.CodeAction | vscode.Command)[]> {

        const position = range.start;
        const hoverPosition = getHoveredWord(document, position);
        if (!hoverPosition) return [];

        const { regex: wordWatcherRegex } = this.wordWatcher.getWordWatcherRegexInfo();
        if (!wordWatcherRegex.test(hoverPosition.text)) {
            return [];
        }

        return [__<vscode.CodeAction>({
            title: `Add word watcher exclusion for: '${hoverPosition.text}'`,
            kind: vscode.CodeActionKind.QuickFix,
            command: {
                title: "Add Word Watcher Exclusion",
                command: "wt.wordWatcher.addExclusion",
                arguments: [ hoverPosition.text ]
            }
        })];
    }
}