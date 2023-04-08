import * as vscode from 'vscode';
import * as console from '../../vsconsole';
import * as extension from '../../extension';
import { capitalize, getHoverText, getHoveredWord } from '../common';
import { Workspace } from '../../workspace/workspaceClass';
import { VeryIntellisense } from './veryIntellisense';
import { queryVery } from './veryQuery';

const alreadyObtained: { [index: string]: string[] | null } = {};

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
        const otherWord = veryText.split(' ')[1];

        // Query losethevery for the selected very word
        const already = alreadyObtained[otherWord];
        if (already === null) return [];

        const specificSynonyms = already || await queryVery(otherWord);
        if (!specificSynonyms) {
            alreadyObtained[otherWord] = null;
            return [];
        }

        // Log the other word as already obtained
        alreadyObtained[otherWord] = specificSynonyms;

        // Create code actions for all the very synonyms
        return specificSynonyms.map(suggest => {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, intersection, suggest);
            return <vscode.CodeAction> {
                title: `Replace with: '${capitalize(suggest)}'`,
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

    }

}

