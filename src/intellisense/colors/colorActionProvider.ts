import * as vscode from 'vscode';
import * as console from '../../miscTools/vsconsole';
import * as extension from '../../extension';
import { getHoverText, getHoveredWord } from '../common';
import { capitalize } from '../../miscTools/help';
import { Workspace } from '../../workspace/workspaceClass';
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

        const text = document.getText();
        const colorStart = document.offsetAt(intersection.range.start);
        const colorEnd = document.offsetAt(intersection.range.end);
        const color = text.substring(colorStart, colorEnd).toLocaleLowerCase();

        // Create code actions for all the very synonyms
        return intersection.group.map(suggest => {
            if (suggest === color) return [];
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, intersection.range, suggest);
            return <vscode.CodeAction> {
                title: `Replace with: '${capitalize(suggest)}'`,
                edit: edit,
                kind: vscode.CodeActionKind.QuickFix,
            }
        }).flat() || [];
    }

}