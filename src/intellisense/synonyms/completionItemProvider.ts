import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../miscTools/vsconsole';
import { Capitalization, HoverPosition, capitalize, getHoverText, getHoveredWord, getTextCapitalization, transformToCapitalization } from '../common';
import { SynonymError, SynonymSearchResult, Synonyms, SynonymsProvider } from '../synonymsProvider/provideSynonyms';

const NUMBER_COMPLETES = 20;


function numDigits(x: number): number {
    return Math.max(Math.floor(Math.log10(Math.abs(x))), 0) + 1;
}

type ActivationState = {
    hoverRange: vscode.Range,
    hoverPosition: HoverPosition,
    word: string, 
    lastSelectedDefinition: number,
    definitionsActivated: boolean[],
    definitionsExpanded: boolean[],
    selected: number,
    ts: number
}


export class CompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
    private activationState?: ActivationState;

    private isWordHippo;
    private allCompletionItems: vscode.CompletionItem[] = [];
    private forceSelectIndex: boolean = false;

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        useWordHippo: boolean,
    ) { 
        this.registerCommands();
        this.isWordHippo = useWordHippo;
    }

    async provideCompletionItems(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken, 
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionList<vscode.CompletionItem> | vscode.CompletionItem[]> {
        let wordText: string;
        let hoverPosition: HoverPosition; 
        let hoverRange: vscode.Range;
        {
            // 16m ~ 1 frame --> allow 10 frames to have passed between when .ts was set
            if (this.activationState && Date.now() - this.activationState.ts < 16 * 10) {
                // If the last activation of this compltion was less than 5 ms ago, then
                //      use that activation state
                // Hacky solution to allow the folders from #78 to word with word hippo
                hoverPosition = this.activationState.hoverPosition;
                hoverRange = this.activationState.hoverRange;
                wordText = this.activationState.word;
            }
            else {

                const selection = vscode.window.activeTextEditor?.selection;
                if (this.isWordHippo && selection && !selection.isEmpty) {
                    // If we're using word hippo and the selection is not empty then call get hovered position on both the start
                    //      and end of the selection to get the full range of selected text
                    const start = getHoveredWord(document, selection.start);
                    const end = getHoveredWord(document, selection.end);
    
                    if (!start || !end) {
                        return [];
                    }
    
                    // Transform each to offsets
                    start.start, start.end
                    end.start, end.end
    
                    // Order start and end offsets
                    const startOff = start.start < end.start ? start.start : end.start;
                    const endOff = end.end < start.end ? start.end : end.end;
    
                    wordText = document.getText().substring(startOff, endOff);
                    
                    hoverRange = new vscode.Range(document.positionAt(startOff), document.positionAt(endOff));
    
                    hoverPosition = {
                        start: startOff,
                        end: endOff,
                        text: wordText.split(/\s/g).join('_')
                    }
                }
                else {
                    // Otherwise, simply call hover position on the provided position
                    const tmp = getHoveredWord(document, position);
                    if (!tmp) return [];
                    hoverPosition = tmp;
                    wordText = tmp.text;
                    hoverRange = new vscode.Range(document.positionAt(hoverPosition.start), document.positionAt(hoverPosition.end));
                }
            }
        }

        
        // Query the synonym api for the hovered word
        let response: Synonyms;
        // if (this.cache[wordText]) {
        //     const result = this.cache[wordText];
        //     if (result.type === 'error') {
        //         return getMisspellCorrections(result, hoverRange, wordText);
        //     }
        //     response = result;
        // }
        // else {


        // Query the dictionary api for the selected word
        const res = await SynonymsProvider.provideSynonyms(hoverPosition.text, this.isWordHippo ? 'wh' : 'synonymsApi');
        if (res.type === 'error') {
            // this.cache[wordText] = res;
            return getMisspellCorrections(res, hoverRange, wordText);
        }

        // If there was no error querying for synonyms of the selected word, then store the response from
        //      the dictionary api and cache it for later
        response = res;
        //     this.cache[wordText] = response;
        // }

        
        const defs = response.definitions;


        let activations: boolean[];
        let expansions: boolean[];
        if (this.activationState && this.activationState.word === wordText && this.activationState.hoverRange.isEqual(hoverRange)) {
            // If the activation state of the current hover is for the same word and same range
            //      in the text document as the previous activation, use the activations of that 
            //      state for this call
            activations = this.activationState.definitionsActivated;
            expansions = this.activationState.definitionsExpanded;
        }
        else {

            // Remove the current activation state if it does not match the same word as the 
            //      last time this function was called
            // Since activation state is used to keep track of which definitions of the *current*
            //      hovered word are shown, we cannot allow those definitions and definition activation
            //      state to effect this new word
            this.activationState = undefined;

            // If there is only a single definition for the selected word, then have that definition open by default
            const defaultOpen = defs.length === 1;
            activations = Array.from({ length: defs.length }, () => defaultOpen);

            // We can copy the falses from activations for the expansions array
            // Don't use the same array for obv reasons
            expansions = [...activations];

            // Also create a new activation state for this completion
            this.activationState = {
                hoverPosition: hoverPosition,
                hoverRange: hoverRange,
                word: wordText,
                lastSelectedDefinition: 0,
                definitionsActivated: activations,
                definitionsExpanded: expansions,
                selected: 0,
                ts: Date.now()
            };
        }

        let itemsCount = 0;

        const maxDigits = numDigits(defs.length);

        // Create completion items for each of the definitions
        const allItems: vscode.CompletionItem[] = [];
        for (let definitionIndex = 0; definitionIndex < defs.length; definitionIndex++) {
            const def = defs[definitionIndex];
            let preselectDefinition: boolean = false;
            if (this.forceSelectIndex) {
                preselectDefinition = itemsCount === this.activationState?.selected;
            }
            else {
                preselectDefinition = definitionIndex === this.activationState?.lastSelectedDefinition;
                if (preselectDefinition && this.activationState) {
                    this.activationState.selected = itemsCount;
                }
            }

            const indexStr = ("" + definitionIndex).padStart(maxDigits, '0')
            const definitionCompletion = <vscode.CompletionItem> {
                label: `(${def.part}) ${def.definitions[0]}`,
                filterText: wordText,
                insertText: wordText,
                detail: `(${def.synonyms.length} synonyms)`,
                documentation: new vscode.MarkdownString(`- ${def.definitions.filter(d => d.length > 0).map(d => capitalize(d)).join('\n- ')}`),
                range: hoverRange,
                kind: vscode.CompletionItemKind.Folder,

                // Preselect this definition if it was the last definition chosen
                preselect: preselectDefinition,

                sortText: indexStr,

                // Command to be executed *after* the `insertText` above is inserted over the `hoverRange`
                // `activateDefinition` will toggle the activation status of this definition and then
                //      reopen the completion items menu
                // To the user, this appears as if they had toggled an option and added all the synonyms
                //      of the selected definition into the completion box
                command: {
                    command: 'wt.intellisense.synonyms.activateDefinition',
                    arguments: [ definitionIndex ]
                },
            };
            itemsCount++;

            // If the current definition is activated, then also show all the synonyms for the hovered definition
            let synonymCompletions: vscode.CompletionItem[] = []
            if (activations[definitionIndex]) {
                synonymCompletions = await this.resolveDefinitionItems(hoverRange, hoverPosition, wordText, definitionIndex, indexStr);
                const originalLength = synonymCompletions.length;
                if (!expansions[definitionIndex] && originalLength > 5) {
                    synonymCompletions = synonymCompletions.slice(0, 5);
                    synonymCompletions.push({
                        label: 'Show more . . . ',
                        detail: `${originalLength - 5} more`,
                        filterText: wordText,
                        insertText: wordText,
                        range: hoverRange,
                        kind: vscode.CompletionItemKind.Enum,
                        sortText: `${indexStr}!!expand`,
                        command: {
                            command: `wt.intellisense.synonyms.activateShowMoreLess`,
                            arguments: [ definitionIndex ],
                            title: 'Activate Show More'
                        }
                    });
                }
                else if (expansions[definitionIndex] && originalLength > 5) {
                    synonymCompletions.push({
                        label: 'Show less . . . ',
                        detail: `hide ${originalLength - 5} synonyms`,
                        filterText: wordText,
                        insertText: wordText,
                        range: hoverRange,
                        kind: vscode.CompletionItemKind.EnumMember,
                        sortText: `${indexStr}!!collapse`,
                        command: {
                            command: `wt.intellisense.synonyms.activateShowMoreLess`,
                            arguments: [ definitionIndex ],
                            title: 'Activate Show Less'
                        }
                    });
                }
                itemsCount += synonymCompletions.length;
            }

            // Return the definition completion item and all the synonyms for that definition (if the definition is activated)
            [
                definitionCompletion,
                ...synonymCompletions
            ].forEach(item => allItems.push(item));
        }
        this.allCompletionItems = allItems;
        return allItems;
    }

    // Returns a list of completion items for each synonym for a selected word's selected definition
    async resolveDefinitionItems (
        hoverRange: vscode.Range,
        hoverPosition: HoverPosition,
        word: string, 
        definitionIndex: number,
        defIndexStr: string
    ): Promise<vscode.CompletionItem[]> {
        
        const wordCapitalization: Capitalization = getTextCapitalization(word);

        const synonyms = await SynonymsProvider.provideSynonyms(word, this.isWordHippo ? 'wh' : 'synonymsApi');
        if (!synonyms || synonyms.type === 'error') return [];

        // Create completion items for all synonyms of all definitions
        const inserts: { [index: string]: 1 } = {};
        const def = synonyms.definitions[definitionIndex];

        const maxDigits = numDigits(def.synonyms.length);

        // Return completion items for all synonyms of the selection definition
        return def.synonyms.map((syn, index) => {
            // Clean up the text of the definition for replacing
            // Some synonyms have some extra bits in parentheses
            // EX:
            //      'word (some other bs)'
            // Clear that portion of the synonym by splitting on the first opening
            //      parenthesis taking the first item from the array
            const insertText = syn.split('(')[0].trim();
            const insertTextWithCapitalization = transformToCapitalization(insertText, wordCapitalization);
            const displayTextWithCapitalization = transformToCapitalization(syn, wordCapitalization);

            // For removing duplicates -- check if in the inserts map
            if (inserts[insertText] === 1) {
                return [];
            }
            inserts[insertText] = 1;

            const indexStr = ("" + index).padStart(maxDigits, '0')

            return <vscode.CompletionItem> {
                label: displayTextWithCapitalization,
                filterText: word,
                insertText: insertTextWithCapitalization,
                detail: `[${def.definitions[0]}]`,
                range: hoverRange,
                kind: vscode.CompletionItemKind.Event,

                // Sort text is a string used by vscode to sort items within the completion items box
                // Sort text is derived index of the definition and a the padded index of
                //      this synonym
                // Using the definition index first in the sort key makes it so all synonyms to a certain
                //      definition will appear below that definition
                sortText: `${defIndexStr}!!${indexStr}`
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
            this.activationState.ts = Date.now();

            // Then reopen the suggestions panel
            vscode.commands.executeCommand('editor.action.triggerSuggest');
        });

        
        vscode.commands.registerCommand(`wt.intellisense.synonyms.activateShowMoreLess`, (definitionIndex: number) => {
            if (!this.activationState) return;

            // Flip the activation status of the selected definition
            const currentDefinitionState = this.activationState.definitionsExpanded[definitionIndex];
            this.activationState.definitionsExpanded[definitionIndex] = !currentDefinitionState;
            this.activationState.lastSelectedDefinition = definitionIndex;
            this.activationState.ts = Date.now();

            // Then reopen the suggestions panel
            vscode.commands.executeCommand('editor.action.triggerSuggest');
        });

        vscode.commands.registerCommand('wt.intellisense.synonyms.shiftMode', () => {
            // Reset word hippo status, activation state, and cache
            this.isWordHippo = !this.isWordHippo;
            this.activationState = undefined;

            const using = this.isWordHippo
                ? 'Word Hippo'
                : 'Dictionary API'
            vscode.window.showInformationMessage(`[INFO] Synonyms intellisense is now using ${using} for completion`);
        });

        vscode.commands.registerCommand("wt.intellisense.synonyms.prevSelection", async () => {
            if (!this.activationState) return vscode.commands.executeCommand('selectPrevSuggestion');
            this.activationState.selected--;
            if (this.activationState.selected < 0) {
                this.activationState.selected = this.allCompletionItems.length - 1;
            }
            return vscode.commands.executeCommand('selectPrevSuggestion')
        })
        vscode.commands.registerCommand("wt.intellisense.synonyms.nextSelection", async () => {
            if (!this.activationState) return vscode.commands.executeCommand('selectNextSuggestion')
            this.activationState.selected = (this.activationState.selected + 1) % this.allCompletionItems.length;
            return vscode.commands.executeCommand('selectNextSuggestion');
        })

        vscode.commands.registerCommand(`wt.intellisense.synonyms.prevDefinition`, async () => {
            if (!this.activationState) return;
            if (this.activationState.selected === 0) {
                let lastDefIndex = 0;
                this.allCompletionItems.forEach((item, index) => {
                    if (!item.sortText?.includes('!!')) {
                        lastDefIndex = index;
                    }
                })
                this.activationState.selected = lastDefIndex;
            }
            else {
                // Parse int still words on synonym's sort keys:
                //      parseInt('0!!001') === 0
                //      parseInt('324!!024') === 324
                const selectedItemIndex = this.allCompletionItems[this.activationState.selected].sortText!;
                const selectedDefinitionIndex = parseInt(selectedItemIndex);
                for (; this.activationState.selected > 0; this.activationState.selected--) {
                    const curItem = this.allCompletionItems[this.activationState.selected];
                    
                    if (curItem.sortText?.includes('!!')) continue;
                    
                    const curItemDefIndex = parseInt(curItem.sortText!);
                    if (curItemDefIndex < selectedDefinitionIndex ||  (curItemDefIndex === selectedDefinitionIndex && selectedItemIndex !== curItem.sortText)) {
                        break;
                    }
                }
            }

            
            this.activationState.ts = Date.now();

            this.forceSelectIndex = true;
            await vscode.commands.executeCommand('hideSuggestWidget');
            await vscode.commands.executeCommand('editor.action.triggerSuggest');
            this.forceSelectIndex = false;
        });

        vscode.commands.registerCommand(`wt.intellisense.synonyms.nextDefinition`, async () => {
            if (!this.activationState) return;
            if (this.activationState.selected >= this.allCompletionItems.length - 1) {
                this.activationState.selected = 0;
            }
            else {
                const selectedItemIndex = this.allCompletionItems[this.activationState.selected].sortText!;
                const selectedDefinitionIndex = parseInt(selectedItemIndex);
                for (; this.activationState.selected < this.allCompletionItems.length; this.activationState.selected++) {
                    const curItem = this.allCompletionItems[this.activationState.selected];
                    const curItemDefIndex = parseInt(curItem.sortText!);
                    if (curItemDefIndex > selectedDefinitionIndex) {
                        console.log("borp")
                        break;
                    }
                }
            }

            this.activationState.ts = Date.now();

            this.forceSelectIndex = true;
            await vscode.commands.executeCommand('hideSuggestWidget');
            await vscode.commands.executeCommand('editor.action.triggerSuggest');
            this.forceSelectIndex = false;
        });

    }
}

const getMisspellCorrections = (res: SynonymError, hoverRange: vscode.Range, wordText: string) => {
    if (!res.suggestions) return [];
    const maxDigits = numDigits(res.suggestions.length);
    return res.suggestions?.map((suggest, index) => {
        const indexStr = ("" + index).padStart(maxDigits, '0')
        return <vscode.CompletionItem> {
            label: suggest,
            range: hoverRange,
            filterText: wordText,
            sortText: indexStr
        }
    }) || [];
}