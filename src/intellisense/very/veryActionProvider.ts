import * as vscode from 'vscode';
import * as console from '../../miscTools/vsconsole';
import * as extension from '../../extension';
import { getHoverMarkdown, getHoveredWord } from '../common';
import { capitalize } from '../../miscTools/help';
import { Workspace } from '../../workspace/workspaceClass';
import { VeryIntellisense } from './veryIntellisense';
import { queryVery } from './veryQuery';

type QueryResult = {
    type: 'success',
    result: string[],
} | {
    type: 'failed',
    action: vscode.CodeAction
}

const alreadyObtained: { [index: string]: QueryResult } = {};

export class VeryActionProvider implements vscode.CodeActionProvider {
    async provideCodeActions (
        document: vscode.TextDocument, 
        range: vscode.Range | vscode.Selection, 
        context: vscode.CodeActionContext, 
        token: vscode.CancellationToken
    ): Promise<(vscode.CodeAction | vscode.Command)[]> {
        
        // Get all the veries in the active document, check if any of them intersect with the 
        //      selected range
        const allVeries = this.veryIntellisense.getVeries();
        const intersection = allVeries.find(very => very.contains(range));
        if (!intersection) return [];

        // Isolate the word after very in the intersected range
        const start = document.offsetAt(intersection.start);
        const end = document.offsetAt(intersection.end);
        const veryText = document.getText().substring(start, end);
        const [ very, otherWord ] = veryText.split(' ');

        // Query losethevery for the selected very word
        const already = alreadyObtained[otherWord];
        if (already && already.type === 'failed') return [ already.action ];

        const specificSynonyms = already?.result || await queryVery(otherWord);
        if (!specificSynonyms) {
            const action = {
                title: 'Unable to query very synonyms: Open in a new browser?',
                isPreferred: true,
                command: {
                    command: 'wt.very.openBrowser',
                    title: 'Open Very Browser',
                    arguments: [ otherWord ],
                },
                kind: vscode.CodeActionKind.QuickFix,
            }
            alreadyObtained[otherWord] = {
                type: 'failed',
                action: action,
            };
            console.log(action)
            return [ action ];
        }

        // Log the other word as already obtained
        alreadyObtained[otherWord] = {
            type: 'success',
            result: specificSynonyms
        };

        // Create code actions for all the very synonyms
        return specificSynonyms.map(suggest => {
            const edit = new vscode.WorkspaceEdit();

            // If very is capitalized, also capitalize the replaced word
            const capitalized = capitalize(suggest);
            const suggestedWord = very === 'Very'
                ? capitalized
                : suggest;
            edit.replace(document.uri, intersection, suggestedWord);

            
            return <vscode.CodeAction> {
                title: `Replace with: '${capitalized}'`,
                edit: edit,
                kind: vscode.CodeActionKind.QuickFix,
            }
        }) || [];
    }
    
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        private veryIntellisense: VeryIntellisense
    ) {
        this.registerCommands();
    }

    registerCommands () {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.very.openBrowser', (veryWord: string) => {
            vscode.env.openExternal(vscode.Uri.parse(`https://www.losethevery.com/another-word/very-${veryWord}`))
        }));
    }

}

