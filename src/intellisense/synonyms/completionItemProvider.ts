import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { getHoverText, getHoveredWord } from '../common';
import { query } from '../querySynonym';
import { HoverProvider } from './hoverProvider';

const NUMBER_COMPLETES = 20;

export class CompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace
    ) { 
        
    }

    async provideCompletionItems(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken, 
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionList<vscode.CompletionItem> | vscode.CompletionItem[]> {
        const hoverPosition = getHoveredWord(document, position);
        if (!hoverPosition) return [];

        const hoverRange = new vscode.Range(document.positionAt(hoverPosition.start), document.positionAt(hoverPosition.end));
        
        // Query the synonym api for the hovered word
        const response = await query(hoverPosition.text);
        if (response.type === 'error') {
            return response.suggestions?.map(suggest => {
                return <vscode.CompletionItem> {
                    label: suggest,
                    range: hoverRange,
                    filterText: hoverPosition.text,
                }
            }) || [];
        }

        // Create completion items for all synonyms of all definitions
        const inserts: { [index: string]: 1 } = {};
        const allSynonyms = response.definitions.map(def => {
            return def.synonyms.map(syn => {
                
                // Clean up the text of the definition for replacing
                // Some synonyms have some extra bits in parentheses
                // EX:
                //      'word (some other bs)'
                // Clear that portion of the synonym by splitting on the first opening
                //      parenthesis taking the first item from the array
                const insertText = syn.split('(')[0].trim();

                // For removing duplicates -- check if in the inserts map
                if (inserts[insertText] === 1) {
                    return [];
                }
                inserts[insertText] = 1;

                return <vscode.CompletionItem> {
                    label: `(${def.part}) ${syn}`,
                    filterText: hoverPosition.text,
                    insertText: insertText,
                    detail: `[${def.definitions[0]}]`,
                    range: hoverRange,
                }
            }).flat();
        }).flat();

        // Also create a completion item for the existing text 
        // This exists so the user can get the defintion of the word they're hovering
        const hovered = <vscode.CompletionItem> {
            label: hoverPosition.text,
            filterText: hoverPosition.text,
            insertText: hoverPosition.text,
            range: hoverRange,
        };

        // Return the hovered item and all its synonyms as a single completion item array
        return [
            ...allSynonyms,
            hovered,
        ]
    }


    async resolveCompletionItem (
        item: vscode.CompletionItem, 
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem> {
        if (!item.insertText) {
            return item;
        }

        // When resolving a completion item that has insert text (should be all possible
        //      completion items), then use the hover provider to get hover text string
        //      and use that as the doc string for the completion item
        try {
            const syn = item.insertText as string;
            const documentation = await getHoverText(syn);
            item.documentation = new vscode.MarkdownString(documentation);
            return item;
        }
        catch (e) { 
            return item;
        }
    }
}