import * as vscode from 'vscode';
import { Timed } from '../../timedView';
import { Workspace } from '../../workspace/workspaceClass';
import { dictionary } from './dictionary';
import { PersonalDictionary } from './personalDictionary';
import { WordRange } from '../../intellisense/common';
import { NotebookPanel } from '../../notebook/notebookPanel';
import { compareFsPath, formatFsPathForCompare } from '../../miscTools/help';
import { Autocorrect } from '../../autocorrect/autocorrect';
import { SynonymsProvider } from '../synonymsProvider/provideSynonyms';
import { ExtensionGlobals } from '../../extension';


export class Spellcheck implements Timed {
    enabled: boolean;
    
    private static RedUnderline: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		overviewRulerColor: new vscode.ThemeColor('errorForeground'),
        textDecoration: 'underline wavy',
        color: new vscode.ThemeColor('errorForeground'),
        borderColor: new vscode.ThemeColor('errorForeground'),
    });

    lastUpdate: WordRange[];
    async update (editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        const stops = /[\^\.\?,\s\;'":\(\)\{\}\[\]\/\\\-!\*_]/g;

        const document = editor.document;
        if (!document) return;

        const decorations: vscode.DecorationOptions[] = [];

        const fullText: string = document.getText();
        const visible: vscode.Range[] = [ ...editor.visibleRanges ];
        for (const { start: visibleStart, end: visibleEnd } of visible) {
            const textStartOff = document.offsetAt(visibleStart);
            const textEndOff = document.offsetAt(visibleEnd);
            const text: string = fullText.substring(textStartOff, textEndOff);
            const words: WordRange[] = [];
    
            // Function to parse a word from the document text and add
            //      it to the word range array
            const addWord = (startOff: number, endOff: number) => {
                const start = document.positionAt(startOff);
                const end = document.positionAt(endOff);
                if (Math.abs(startOff - endOff) <= 1) return;

                // Do not add the word if it is inside of commented ranges
                const isCommented = commentedRanges.find(cr => {
                    if (cr.contains(start)) {
                        return cr;
                    }
                });
                if (isCommented !== undefined) return;
                
                const wordRange = new vscode.Range(start, end);
    
                const word = fullText.substring(startOff, endOff);
                words.push({
                    text: word.toLocaleLowerCase()
                        .replaceAll(/[#~]/g, '')                                // Strip style characters
                        .normalize("NFD").replace(/[\u0300-\u036f]/g, ""),      // Strip diacritics,
                    range: wordRange,
                });
            }
    
            // Iterate over all (but the last) word in the document
            //      and all those words to the word ranges array
            let startOff: number = textStartOff;
            let endOff: number;
            let match: RegExpExecArray | null;
            while ((match = stops.exec(text)) !== null) {
                const matchReal: RegExpExecArray = match;
                endOff = matchReal.index + textStartOff;
                addWord(startOff, endOff);
                startOff = endOff + 1;
            }
    
            // Add the last word
            endOff = textEndOff;
            addWord(startOff, endOff);

            // Create red underline decorations for each word that does not
            //      exist in the dictionary or personal dictionary
            for (const { text, range } of words) {
                if (/\d+/.test(text)) continue;                                                         // do not make red if the word is made up entirely of numbers
                if (dictionary[text]) continue;                                                         // do not make red if the dictionary contains this word
                if (this.personalDictionary.search(text)) continue;                                     // do not make red if the personal dictionary contains this word

                // Do not make red if the autocorrector can replace the word
                if (await this.autocorrect.tryCorrection(text, editor, range)) {
                    continue;
                }


                // Do not add red decorations to words that have been matched by notebook
                const notebookPanel = ExtensionGlobals.notebookPanel;
                if (notebookPanel) {
                    if (notebookPanel.matchedNotebook) {
                        const matches = notebookPanel.matchedNotebook[formatFsPathForCompare(document.uri)];
                        if (matches && matches.find(note => note.range.contains(range))) {
                            continue;
                        }
                    }
                }

                decorations.push({
                    range: range,
                    hoverMessage: `Unrecognized word: ${text}`
                });
            }
    
        }
        // Set all red underlines
        editor.setDecorations(Spellcheck.RedUnderline, decorations);
    }

    // 
    async disable? (): Promise<void> {
        // Simply clear all four of the proximity decorators
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(Spellcheck.RedUnderline, []);
        }
    }


    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        private personalDictionary: PersonalDictionary,
        private autocorrect: Autocorrect,
    ) {
        this.enabled = true;
        this.lastUpdate = [];
        this.context.subscriptions.push(Spellcheck.RedUnderline);
    }
}