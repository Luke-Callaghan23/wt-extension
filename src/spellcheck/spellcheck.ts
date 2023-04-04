import * as vscode from 'vscode';
import { query } from '../synonyms/intellisense/querySynonym';
import { Timed } from '../timedView';
import { Workspace } from '../workspace/workspaceClass';
import { dictionary } from './dictionary';
import { PersonalDictionary } from './personalDictionary';

type WordRange = {
    text: string,
    range: vscode.Range,
};

export class Spellcheck implements Timed {
    enabled: boolean;
    
    private static RedUnderline: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        borderStyle: 'none none solid none',
		borderWidth: '5px',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
        borderColor: 'red',
		overviewRulerColor: 'red',
    });

    lastUpdate: WordRange[];
    async update (editor: vscode.TextEditor): Promise<void> {
        const stops = /[\.\?,\s\;'":\(\)\{\}\[\]\/\\\-!\*_]/;

        const document = editor.document;
        if (!document) return;
        
        const words: WordRange[] = [];
        const text: string = document.getText();

        // Function to parse a word from the document text and add
        //      it to the word range array
        const addWord = (startOff: number, endOff: number) => {
            const start = document.positionAt(startOff);
            const end = document.positionAt(endOff);
            if (Math.abs(start - end) <= 1) return;
            
            const wordRange = new vscode.Range(start, end);

            const word = text.substring(startOff, endOff);
            words.push({
                text: word.toLocaleLowerCase(),
                range: wordRange,
            });
        }

        // Iterate over all (but the last) word in the document
        //      and all those words to the word ranges array
        let startOff: number = 0;
        let endOff: number;
        let match: RegExpExecArray | null;
        while ((match = stops.exec(text))) {
            const matchReal: RegExpExecArray = match;
            endOff = matchReal.index;
            addWord(startOff, endOff);
            startOff = endOff + 1;
        } 

        // Add the last word
        endOff = text.length;
        addWord(startOff, endOff);

        // Create red underline decorations for each word that does not
        //      exist in the dictionary or personal dictionary
        const decorations: vscode.DecorationOptions[] = [];
        for (const { text, range } of words) {
            if (!dictionary[text]) return;
            if (!this.personalDictionary.search(text)) return;
            decorations.push({
                range: range,
                hoverMessage: `Unrecognized word: ${text}`
            });
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