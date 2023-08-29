import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { HoverPosition, getHoverText, getHoveredWord } from '../common';
import { SynonymError, Synonyms, query } from '../querySynonym';
import { HoverProvider } from './hoverProvider';

const NUMBER_COMPLETES = 20;

type ActivationState = {
    hoverRange: vscode.Range,
    hoverPosition: HoverPosition,
    word: string, 
    lastSelectedDefinition: number,
    definitionsActivated: boolean[],
}

export class CompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
    private cache: { [index: string]: Synonyms };
    private activationState?: ActivationState;

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace
    ) { 
        this.cache = {};
        this.registerCommands();
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
        const wordText = hoverPosition.text.toLocaleLowerCase();
        let response: Synonyms;
        if (this.cache[wordText]) {
            response = this.cache[wordText];
        }
        else {

            // Query the dictionary api for the selected word
            const res = await query(wordText);
            if (res.type === 'error') {
                return res.suggestions?.map(suggest => {
                    return <vscode.CompletionItem> {
                        label: suggest,
                        range: hoverRange,
                        filterText: wordText,
                    }
                }) || [];
            }

            // If there was no error querying for synonyms of the selected word, then store the response from
            //      the dictionary api and cache it for later
            response = res;
            this.cache[wordText] = response;
        }
        
        const defs = response.definitions;


        let activations: boolean[];
        if (this.activationState && this.activationState.word === wordText && this.activationState.hoverRange.isEqual(hoverRange)) {
            // If the activation state of the current hover is for the same word and same range
            //      in the text document as the previous activation, use the activations of that 
            //      state for this call
            activations = this.activationState.definitionsActivated;
        }
        else {
            // Remove the current activation state if it does not match the same word as the 
            //      last time this function was called
            // Since activation state is used to keep track of which definitions of the *current*
            //      hovered word are shown, we cannot allow those definitions and definition activation
            //      state to effect this new word
            this.activationState = undefined;

            // And use an all-empty array of activations, to mark that none of the definitions are currently activated
            activations = Array.from({ length: defs.length }, () => false);

            // Also create a new activation state for this completion
            this.activationState = {
                hoverPosition: hoverPosition,
                hoverRange: hoverRange,
                word: wordText,
                lastSelectedDefinition: 0,
                definitionsActivated: activations,
            };
        }

        // Create completion items for each of the definitions
        return defs.map((def, definitionIndex) => {
            const definitionCompletion = <vscode.CompletionItem> {
                label: `(${def.part}) ${def.definitions[0]}`,
                filterText: wordText,
                insertText: wordText,
                detail: `[${def.definitions.join(';')}]`,
                range: hoverRange,

                // Preselect this definition if it was the last definition chosen
                preselect: definitionIndex === this.activationState?.lastSelectedDefinition,

                // Sort text is a string used by vscode to sort items within the completion items box
                // Sort text === the index of this definition
                // Since vscode uses strings for sorting instead of numbers, when definitions count > 10
                //      then definitions will start appearing out of order from the original order sent by
                //      the API (string '10' will be sorted before string '2', even though int `10` gets
                //      sorted after int `2`)
                // But, since I don't believe the order sent by the api has any particular meaning, this
                //      shouldn't matter
                // I also don't know if any words do have more than 10 definitions
                // Sort text of activated synonyms also uses the definition index as a prefix so that they 
                //      will all be sorted underneath their respective definitions
                sortText: definitionIndex + '',

                // Command to be executed *after* the `insertText` above is inserted over the `hoverRange`
                // `activateDefinition` will toggle the activation status of this definition and then
                //      reopen the completion items menu
                // To the user, this appears as if they had toggled an option and added all the synonyms
                //      of the selected definition into the completion box
                command: <vscode.Command> {
                    command: 'wt.intellisense.synonyms.activateDefinition',
                    arguments: [ definitionIndex ]
                },
            };

            // If the current definition is activated, then also show all the synonyms for the hovered definition
            let synonymCompletions: vscode.CompletionItem[] = []
            if (activations[definitionIndex]) {
                synonymCompletions = this.resolveDefinitionItems(hoverRange, hoverPosition, wordText, definitionIndex);
            }

            // Return the definition completion item and all the synonyms for that definition (if the definition is activated)
            return [
                definitionCompletion,
                ...synonymCompletions
            ];
        }).flat();
    }

    // Returns a list of completion items for each synonym for a selected word's selected definition
    resolveDefinitionItems (
        hoverRange: vscode.Range,
        hoverPosition: HoverPosition,
        word: string, 
        definitionIndex: number,
    ): vscode.CompletionItem[] {
        
        const synonyms = this.cache[word];
        if (!synonyms) return [];

        // Create completion items for all synonyms of all definitions
        const inserts: { [index: string]: 1 } = {};
        const def = synonyms.definitions[definitionIndex];

        // Return completion items for all synonyms of the selection definition
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
                label: `${syn}`,
                filterText: hoverPosition.text,
                insertText: insertText,
                detail: `[${def.definitions[0]}]`,
                range: hoverRange,

                // Sort text is a string used by vscode to sort items within the completion items box
                // Sort text is derived from the synonym itelf as well as the index of the definition
                //      it belongs to
                // Using the definition index first in the sort key makes it so all synonyms to a certain
                //      definition will appear below that definition
                // Using the synonym text itself next will ensure that all synonyms within a certain
                //      block of definitions will be sorted alphabetically
                sortText: `${definitionIndex}__${syn}`
            }
        }).flat();
    }


    async resolveCompletionItem (
        item: vscode.CompletionItem, 
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem> {
        if (!item.insertText || item.filterText === item.insertText) {
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


    private registerCommands () {
        vscode.commands.registerCommand(`wt.intellisense.synonyms.activateDefinition`, (definitionIndex: number) => {
            if (!this.activationState) return;

            // Flip the activation status of the selected definition
            const currentDefinitionState = this.activationState.definitionsActivated[definitionIndex];
            this.activationState.definitionsActivated[definitionIndex] = !currentDefinitionState;
            this.activationState.lastSelectedDefinition = definitionIndex;

            // Then reopen the suggestions panel
            vscode.commands.executeCommand('focusSuggestion');
        });
    }
}