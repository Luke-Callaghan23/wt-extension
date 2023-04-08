import * as vscode from 'vscode';
import * as console from '../../vsconsole';
import * as extension from '../../extension';
import { capitalize, getHoverText, getHoveredWord } from '../common';
import { query } from '../querySynonym';
import { Workspace } from '../../workspace/workspaceClass';
import { PersonalDictionary } from './../spellcheck/personalDictionary';
import { dictionary } from './../spellcheck/dictionary';
import { ColorIntellisense } from './colorIntellisense';


export class ColorActionProvider implements vscode.CodeActionProvider {
    
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        private colorIntellisense: ColorIntellisense
    ) {

    }

    async provideCodeActions (
        document: vscode.TextDocument, 
        range: vscode.Range | vscode.Selection, 
        context: vscode.CodeActionContext, 
        token: vscode.CancellationToken
    ): Promise<(vscode.CodeAction | vscode.Command)[]> {
        
        // Get all the veries in the active document, check if any of them intersect with the 
        //      selected range
        const allColors = this.colorIntellisense.getColorLocations();
        const intersection = allColors.find(({ range: colorRange }) => colorRange.contains(range));
        if (!intersection) return [];

        // Isolate the word after very in the intersected range
        const start = document.offsetAt(intersection.range.start);
        const end = document.offsetAt(intersection.range.end);
        const veryText = document.getText().substring(start, end);
        const otherWord = veryText.split(' ')[1];

        // Create code actions for all the very synonyms
        return intersection.group.map(suggest => {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, intersection.range, suggest);
            return <vscode.CodeAction> {
                title: `Replace with: '${capitalize(suggest)}'`,
                edit: edit,
                kind: vscode.CodeActionKind.QuickFix,
            }
        }) || [];
    }

}