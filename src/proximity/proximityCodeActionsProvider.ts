import * as vscode from 'vscode';
import * as extension from '../extension';
import { capitalize, getHoveredWord } from '../synonyms/intellisense/common';
import { query } from '../synonyms/intellisense/querySynonym';
import { Workspace } from '../workspace/workspaceClass';
import { Proximity } from './proximity';

export class ProximityCodeActions implements vscode.CodeActionProvider {
    
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        private proximity: Proximity
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

        const hoverRange = new vscode.Range(document.positionAt(hoverPosition.start), document.positionAt(hoverPosition.end));
        
        // Check to see if the hovered range is the same range as any of the currently hightlighted items by the 
        //      proximity checker
        const isHighlight = this.proximity.getAllHighlights().find(highlight => {
            return highlight.isEqual(hoverRange)
        });
        // If the hovered word is not in the proximity highlights, then this code action provider is not concerned
        //      with it
        if (!isHighlight) return [];
        
        // If the word is highlighted, then query its synonyms
        const response = await query(hoverPosition.text);
        if (response.type === 'error') return [];

        // Return all synonyms for the highlighted word
        return response.definitions.map(def => {
            return def.synonyms.map(syn => {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, hoverRange, syn);
                return <vscode.CodeAction> {
                    title: `Replace with: '${capitalize(syn)}'`,
                    edit: edit,
                    kind: vscode.CodeActionKind.QuickFix,
                }
            })
        }).flat() || [];
    }
}