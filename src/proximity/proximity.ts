import { clear } from 'console';
import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { Workspace } from '../workspace/workspaceClass';
import { Timed } from '../timedView';
import { Packageable } from '../packageable';
import { Paragraph, Word } from './wordStructures';
import { Ranks } from './ranks';
import { ProximityCodeActions } from './proximityCodeActionsProvider';

export class Proximity implements Timed, Packageable {

    
    private filtered: RegExp[] = [ 
        // Common words
        /a/, /the/, /of/, /i/, 
        /to/, /you/, /not/, /too/,
        /her/, /she/, /him/, /he/,
        /and/, /so/, /for/, /my/,

        // Whitespace
        /\s+/, 

        // Empty string
        /^$/, 

        // Any single character non-alphanumberic character
        /[^a-zA-Z0-9]/,
    ];

    shouldFilterWord ({ text }: Word): boolean {
        return (
            this.filtered.find(filt => filt.test(text)) !== undefined
            || this.additionalPatterns.find(filt => filt.test(text)) !== undefined
        );
    }


    // Command for adding a new pattern to be filtered from proximity checks
    async addPattern () {
        while (true) {
            const response = await vscode.window.showInputBox({
                placeHolder: 'supercalifragilisticexpialidocious',
                ignoreFocusOut: false,
                prompt: `Enter the word or word pattern that you would like to exclude from proximity checks (note: only alphabetical characters are allowed)`,
                title: 'Add pattern'
            });
            if (!response) return;

            // Regex for filtering out responses that do not follow the regex subset for specifying watched words
            // Subset onyl includes: groupings '()', sets '[]', one or more '+', zero or more '*', and alphabetical characters
            const allowCharacters = /^[a-zA-Z\(\)\[\]\*\+\?-]+$/;
            // Regex for matching any escaped non-alphabetical character
            const escapedNonAlphabetics = /\\\(|\\\[|\\\]|\\\)|\\\*|\\\+|\\\?|\\\-/;

            // Test to make sure there aren't any invalid characters in the user's response or if there are any escaped characters that
            //      should not be escaped
            if (!allowCharacters.test(response) || escapedNonAlphabetics.test(response)) {
                const proceed = await vscode.window.showInformationMessage(`Could not parse specified word/pattern!`, {
                    modal: true,
                    detail: "List of allowed characters in watched word/pattern is: a-z, A-Z, '*', '+', '?', '(', ')', '[', ']', and '-', where all non alphabetic characters must not be escaped."
                }, 'Okay', 'Cancel');
                if (proceed === 'Cancel') return;
                continue;
            }

            // Attempt to creat a regex from the response, if the creation of a regexp out of the word caused an exception, report that to the user
            let reg: RegExp;
            try {
                reg = new RegExp(response);
            }
            catch (e) {
                const proceed = await vscode.window.showInformationMessage(`An error occurred while creating a Regular Expression from your response!`, {
                    modal: true,
                    detail: `Error: ${e}`
                }, 'Okay', 'Cancel');
                if (proceed === 'Cancel') return;
                continue;
            }

            // If the word is valid and doesn't already exist in the word list, then continue adding the words
            this.additionalPatterns.push(reg);
            this.context.workspaceState.update('wt.wordWatcher.additionalPatterns', this.additionalPatterns.map(pat => pat.source));
            if (vscode.window.activeTextEditor) {
                this.update(vscode.window.activeTextEditor);
            }
            return;
        }
    }

    // Command for removing a filtered pattern
    async removePattern () {
        // Show a quick pick menu for all the the existing additional patterns
        const existingPatterns = this.additionalPatterns.map(pat => pat.source);
        if (existingPatterns.length === 0) return;
        const response: string | undefined = await vscode.window.showQuickPick(existingPatterns, {
            ignoreFocusOut: false,
            title: 'Remove Pattern',
            canPickMany: false
        });
        if (!response) return;
        const filter = response;

        // Filter that word from this.additionalPatterns
        const filterIndex = this.additionalPatterns.findIndex(pat => pat.source === filter);
        if (filterIndex === -1) {
            vscode.window.showErrorMessage(`ERROR: Could not find that pattern -- somethign definitely went wrong :(`);
            return;
        }
        this.additionalPatterns.splice(filterIndex, 1);

        // Update state
        this.context.workspaceState.update('wt.wordWatcher.additionalPatterns', this.additionalPatterns.map(pat => pat.source));
        if (vscode.window.activeTextEditor) {
            this.update(vscode.window.activeTextEditor);
        }
    }

    async updateDecorationsForWord (
        editor: vscode.TextEditor, 
        word: Word[],
        decorations: vscode.TextEditorDecorationType
    ) {
        const wordRanges: vscode.Range[] = word.map(({ range }) => range)
        editor.setDecorations(decorations, wordRanges);
    }

    private allHighlights: vscode.Range[] | undefined;
    getAllHighlights (): vscode.Range[] {
        return this.allHighlights || [];
    }

    private static commonDecorations = {
        borderStyle: 'none none dotted none',
		borderWidth: '3px',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	};

    private static primary: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        ...this.commonDecorations,
        borderColor: 'hsla(279, 60%, 36%, 1)',
		overviewRulerColor: 'hsla(279, 60%, 36%, 1)',
    });
    private static secondary: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        ...this.commonDecorations,
        borderColor: 'hsla(218, 42%, 55%, 0.60)',
		overviewRulerColor: 'hsla(218, 42%, 55%, 0.60)',
    });
    private static tertiary: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        ...this.commonDecorations,
        borderColor: 'hsla(161, 82%, 27%, 0.30)',
		overviewRulerColor: 'hsla(161, 82%, 27%, 0.30)',
    });
    private static fourth: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        ...this.commonDecorations,
        borderColor: 'hsla(51, 82%, 60%, 0.25)',
		overviewRulerColor: 'hsla(51, 82%, 60%, 0.25)',
    });

    private static decorators: vscode.TextEditorDecorationType[] = [
        this.primary, this.secondary, this.tertiary, this.fourth
    ];

    async update (editor: vscode.TextEditor): Promise<void> {

        // Index used to indicate the place in Proximity.decorators to start clearing decorations
        // In the case where `x` decorators were used in the last update but `x - n` decorators need
        //      to be used during this update then we need to clear the last `n` decorators in this
        //      update
        let clearIndex = -1;
            
        const document = editor.document;
        if (!document) return;

        const text = document.getText();
        const cursorLocation = editor.selection;
        const cursorOffset = document.offsetAt(cursorLocation.start);
        let cursorParagraph: number | undefined;

        const paragraph = /\n\n/g;
        const paragraphSeparators: number[] = [ 0 ];    // initial paragraph separator is the beginning of the document
        
        // Find all the paragraph separators in the current document
        let match: RegExpExecArray | null;
        while ((match = paragraph.exec(text))) {

            // Check to see if the cursor is in the current paragraph
            const lastParagraph = paragraphSeparators[paragraphSeparators.length - 1];
            if (cursorOffset >= lastParagraph) {
                cursorParagraph = paragraphSeparators.length;
            }

            // Push the index of the current paragraph separator
            paragraphSeparators.push(match.index);
        }

        // Check to see if the cursor is in the current paragraph
        const lastParagraph = paragraphSeparators[paragraphSeparators.length - 1];
        if (cursorOffset >= lastParagraph) {
            cursorParagraph = paragraphSeparators.length;
        }

        // Final paragraph separator is the end of the document
        paragraphSeparators.push(text.length);

        if (!cursorParagraph) return;

        const inspect: {
            paragraph: string,
            start: number,
            end: number,
            range: vscode.Range
        }[] = [];
        
        // Isolate the paragraph before the cursor paragrapg
        if (cursorParagraph !== 1) {
            const prevStart = paragraphSeparators[cursorParagraph - 2];
            const prevEnd = paragraphSeparators[cursorParagraph - 1];
            const prevStartPosition = document.positionAt(prevStart);
            const prevEndPosition = document.positionAt(prevEnd);
            inspect.push({
                paragraph: text.substring(prevStart, prevEnd),
                start: prevStart,
                end: prevEnd,
                range: new vscode.Range(prevStartPosition, prevEndPosition)
            });
        }

        // Isolate the cursor paragraph
        const start = paragraphSeparators[cursorParagraph - 1];
        const end = paragraphSeparators[cursorParagraph];
        const startPosition = document.positionAt(start);
        const endPosition = document.positionAt(end);
        inspect.push({
            paragraph: text.substring(start, end),
            start: start,
            end: end,
            range: new vscode.Range(startPosition, endPosition)
        });

        // Isolate the paragrapg after the cursor paragraph
        if (cursorParagraph !== paragraphSeparators.length - 1) {
            const nextStart = paragraphSeparators[cursorParagraph];
            const nextEnd = paragraphSeparators[cursorParagraph + 1];
            const nextStartPosition = document.positionAt(nextStart);
            const nextEndPosition = document.positionAt(nextEnd);
            inspect.push({
                paragraph: text.substring(nextStart, nextEnd),
                start: nextStart,
                end: nextEnd,
                range: new vscode.Range(nextStartPosition, nextEndPosition)
            });
        }

        // Create paragraph objects for all the inspected paragraphs
        const paragraphs: Paragraph[] = inspect.map(({
            paragraph,
            start,
            end 
        }) => {
            return new Paragraph(this, editor, text, paragraph, start, end)
        });

        // Get all words and all unique words in all the inspected paragraphs
        const allWords: Word[] = paragraphs.map(({ allWords }) => allWords).flat();
        const uniqueWordsMap: { [index: string]: 1 } = {}
        allWords.forEach(({ text }) => {
            uniqueWordsMap[text] = 1;
        });
        const uniqueWords = Object.keys(uniqueWordsMap);

        // Get rankings for words in inspected paragraphs
        const rated = Ranks.assignRatings(
            uniqueWords,
            allWords,
            paragraphs,                                 // all paragraphs
            paragraphs.map(p => p.sentences).flat()     // all sentences
        );

        // If there are no available ratings, indicate that all decorators need to be cleared, and continue
        if (!rated) {
            clearIndex = 0;
            return;
        }
        
        // Create highlights for the ranked words
        this.allHighlights = rated.map((r, index) => {
            // If we found an undefined rating, then clear all decorators after it
            if (!r) {
                if (clearIndex === -1) clearIndex = index;
                return [];
            }
            const decorator = Proximity.decorators[index];
            this.updateDecorationsForWord(editor, r, decorator);
            return r.map(word => word.range);
        }).flat();

        // Clear unused decorators
        if (clearIndex !== -1) {
            Proximity.decorators.slice(clearIndex).forEach(dec => {
                editor.setDecorations(dec, []);
            });
        }

    }

    async disable? (): Promise<void> {
        // Simply clear all four of the proximity decorators
        if (!vscode.window.activeTextEditor) return;
        const editor = vscode.window.activeTextEditor;
        Proximity.decorators.forEach(decoratorType => {
            editor.setDecorations(decoratorType, []);
        });
    }

    enabled: boolean;

    private additionalPatterns: RegExp[];
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {
        this.enabled = true;

        // Read additional excluded words from the workspace state
        const additional: string[] = context.workspaceState.get('wt.wordWatcher.additionalPatterns') || [];
        this.additionalPatterns = additional.map(add => {
            try {
                return new RegExp(add)
            } catch (e) {
                vscode.window.showWarningMessage(`WARN: Could not process proximity pattern '${add}' from workspace state.`)
                return [];
            }
        }).flat();

        vscode.languages.registerCodeActionsProvider (<vscode.DocumentFilter>{
            language: 'wt'
        }, new ProximityCodeActions(context, workspace, this));

        this.registerCommands();
    }

    registerCommands() {
        vscode.commands.registerCommand('wt.proximity.addFilteredWord', () => this.addPattern());
        vscode.commands.registerCommand('wt.proximity.removeFilteredWord', () => this.removePattern())
    }

    getPackageItems(): { [index: string]: any; } {
        return {
            'wt.proximity.additionalPatterns': this.additionalPatterns.map(pat => pat.source)
        }
    }
}