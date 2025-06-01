import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../miscTools/vsconsole';
import { getHoveredWord } from '../common';
import { Capitalization, getTextCapitalization, transformToCapitalization } from '../../miscTools/help';
import { capitalize } from '../../miscTools/help';
import { dictionary } from './../spellcheck/dictionary';
import { PersonalDictionary } from './../spellcheck/personalDictionary';
import { SynonymsProvider } from '../synonymsProvider/provideSynonyms';
import {_} from './../../miscTools/help';

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
        const response = await SynonymsProvider.provideSynonyms(hoverPosition.text, 'synonymsApi');
        if (response.type !== 'error') return [];

        const capitalization = getTextCapitalization(hoverPosition.text);

        // If it's not in any of those, then use the suggested words
        //      from the API response as suggestions for replacements
        const suggestions = response.suggestions?.map(suggest => {
            const replaceText = transformToCapitalization(suggest, capitalization);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, hoverRange, replaceText);
            return <vscode.CodeAction> {
                title: `Replace with: '${replaceText}'`,
                edit: edit,
                kind: vscode.CodeActionKind.QuickFix,
                command: {
                    command: "wt.autocorrections.wordReplaced",
                    arguments: [ hoverPosition.text, replaceText ]
                }
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

        const addToNotebook = _<vscode.CodeAction>({
            title: `Create new notebook note for '${capitalize(hoverPosition.text)}'`,
            command: <vscode.Command> {
                command: 'wt.notebook.addNote',
                arguments: [ capitalize(hoverPosition.text) ]
            },
            kind: vscode.CodeActionKind.QuickFix,
        });

        const addToNotebookNote = _<vscode.CodeAction>({
            title: `Add '${capitalize(hoverPosition.text)}' as new alias for existing note`,
            command: <vscode.Command> {
                command: 'wt.notebook.addAliasToNote',
                arguments: [ capitalize(hoverPosition.text) ]
            },
            kind: vscode.CodeActionKind.QuickFix,
        });

        return [
            addToDict,
            addToNotebook,
            addToNotebookNote,
            ...suggestions
        ];
    }
}