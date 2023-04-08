import * as vscode from 'vscode';
import { query } from '../../intellisense/querySynonym';
import { Timed } from '../../timedView';
import { Workspace } from '../../workspace/workspaceClass';
import { dictionary } from './dictionary';
import { PersonalDictionary } from './personalDictionary';
import * as console from './../../vsconsole';
import { WordRange } from '../../intellisense/common';


export class Spellcheck implements Timed {
    enabled: boolean;
    
    private static RedUnderline: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
		overviewRulerLane: vscode.OverviewRulerLane.Right,
        color: '#ad0505',
		overviewRulerColor: '#ad0505',
    });

    lastUpdate: WordRange[];
    async update (editor: vscode.TextEditor): Promise<void> {
        const stops = /[\.\?,\s\;'":\(\)\{\}\[\]\/\\\-!\*_]/g;

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
                
                const wordRange = new vscode.Range(start, end);
    
                const word = fullText.substring(startOff, endOff);
                words.push({
                    text: word.toLocaleLowerCase(),
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
                if (dictionary[text]) continue;
                if (this.personalDictionary.search(text)) continue;
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
        if (!vscode.window.activeTextEditor) return;
        const editor = vscode.window.activeTextEditor;
        editor.setDecorations(Spellcheck.RedUnderline, []);
    }


    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        private personalDictionary: PersonalDictionary
    ) {
        this.enabled = false;
        this.lastUpdate = [];
    }
}