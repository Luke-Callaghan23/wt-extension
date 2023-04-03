import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { capitalize, getHoveredWord } from './common';
import { query } from './querySynonym';

export class CodeActionProvider implements vscode.CodeActionProvider {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
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
        
        // Query the synonym api for the hovered word
        const response = await query(hoverPosition.text);
        if (response.type !== 'error') return [];



        return response.suggestions?.map(suggest => {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, hoverRange, suggest);
            return <vscode.CodeAction> {
                title: `Replace with: '${capitalize(suggest)}'`,
                // edit: new vscode.TextEdit(hoverRange, suggest),
                edit: edit,
                kind: vscode.CodeActionKind.QuickFix,
            }
        }) || [];
    }
}