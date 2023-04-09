import * as vscode from 'vscode';
import * as console from '../../vsconsole';
import * as extension from '../../extension';
import { WordRange, capitalize, getHoverText, getHoveredWord } from '../common';
import { Workspace } from '../../workspace/workspaceClass';
import { Timed } from '../../timedView';
import { VeryActionProvider } from './veryActionProvider';

export class VeryIntellisense implements Timed {
    enabled: boolean;

    
    private static VeryMarker: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        borderStyle: 'none none solid none',
		borderWidth: '3px',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
        borderColor: '#34c3eb',
		overviewRulerColor: '#34c3eb',
    });


    async update (editor: vscode.TextEditor): Promise<void> {
        const stops = /[\.\?,\s\;'":\(\)\{\}\[\]\/\\\-!\*_]/g;

        const document = editor.document;
        if (!document) return;

        const decorations: vscode.DecorationOptions[] = [];

        this.veries = [];


        const fullText: string = document.getText();
        const visible: vscode.Range[] = [ ...editor.visibleRanges ];
        for (const { start: visibleStart, end: visibleEnd } of visible) {
            const textStartOff = document.offsetAt(visibleStart);
            const textEndOff = document.offsetAt(visibleEnd);
            const text: string = fullText.substring(textStartOff, textEndOff);
            const verily: WordRange[] = [];
    
            // Iterate over all (but the last) word in the document
            //      and all those words to the word ranges array
            let startOff: number;
            let endOff: number = textStartOff - 1;
            let match: RegExpExecArray | null;
            while ((match = stops.exec(text)) !== null) {
                startOff = endOff + 1;
                const matchReal: RegExpExecArray = match;
                endOff = matchReal.index + textStartOff;
                
                const start = document.positionAt(startOff);
                const end = document.positionAt(endOff);
                if (Math.abs(startOff - endOff) <= 1) continue;

                const word = fullText.substring(startOff, endOff).toLocaleLowerCase();
                if (word !== 'very') continue;
                if (fullText[endOff] !== ' ') continue;
                if (!fullText[endOff + 1]?.match(/[A-Za-z]/)) continue;

                const otherWordStart = document.positionAt(endOff + 1);
                const otherWord = getHoveredWord(document, otherWordStart);
                if (!otherWord) continue;

                const veryPlusOtherWord = new vscode.Range(
                    start,
                    document.positionAt(otherWord.end)
                );
                const veryText = fullText.substring(startOff, otherWord.end);

                verily.push(<WordRange> {
                    range: veryPlusOtherWord,
                    text: veryText
                });
            }

            // Create red underline decorations for each word that does not
            //      exist in the dictionary or personal dictionary
            for (const { text, range } of verily) {
                decorations.push({
                    range: range,
                    hoverMessage: `Unrecognized word: ${text}`
                });
                this.veries.push(range);
            }
    
        }
        // Set all red underlines
        editor.setDecorations(VeryIntellisense.VeryMarker, decorations);
    }

    // 
    async disable? (): Promise<void> {
        // Simply clear all four of the proximity decorators
        if (!vscode.window.activeTextEditor) return;
        const editor = vscode.window.activeTextEditor;
        editor.setDecorations(VeryIntellisense.VeryMarker, []);
    }


    private veries: vscode.Range[] | undefined;
    getVeries (): vscode.Range[] {
        return this.veries || [];
    }

    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
    ) {
        this.enabled = true;
        const wtSelector: vscode.DocumentFilter = <vscode.DocumentFilter>{
            language: 'wt'
        };
        vscode.languages.registerCodeActionsProvider(wtSelector, new VeryActionProvider(context, workspace, this));
    }
}