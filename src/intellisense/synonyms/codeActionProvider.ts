import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { capitalize, getHoveredWord } from '../common';
import { query } from '../querySynonym';
import { dictionary } from './../spellcheck/dictionary';
import { PersonalDictionary } from './../spellcheck/personalDictionary';

export class CodeActionProvider implements vscode.CodeActionProvider {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        private personalDict: PersonalDictionary
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
        
        // Check to see if the hovered word is in the dictionary
        const inDict = dictionary[hoverPosition.text] === 1;
        const inPersonalDict = this.personalDict.search(hoverPosition.text);
        if (inDict || inPersonalDict) return [];

        // Then check to see if the thesaurus API has it
        const response = await query(hoverPosition.text);
        if (response.type !== 'error') return [];

        // If it's not in any of those, then use the suggested words
        //      from the API response as suggestions for replacements
        const suggestions = response.suggestions?.map(suggest => {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, hoverRange, suggest);
            return <vscode.CodeAction> {
                title: `Replace with: '${capitalize(suggest)}'`,
                // edit: new vscode.TextEdit(hoverRange, suggest),
                edit: edit,
                kind: vscode.CodeActionKind.QuickFix,
            }
        }) || [];

        const addToDict = <vscode.CodeAction> {
            title: `Add ${capitalize(hoverPosition.text)} to personal dictionary`,
            command: <vscode.Command> {
                command: 'wt.personalDictionary.add',
                arguments: [ hoverPosition.text ]
            },
            isPreferred: true,
            kind: vscode.CodeActionKind.QuickFix
        };

        return [
            addToDict,
            ...suggestions
        ];
    }
}