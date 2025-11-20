import * as vscode from 'vscode';
import { Timed } from '../timedView';
import { fragmentStopReg, punctuationStopsReg } from '../editor/jumps';

export class SpacingHighlights implements Timed {
    enabled: boolean;
    constructor () { this.enabled = true; }
    getUpdatesAreVisible(): boolean { return this.enabled; }

    private static innerSentenceSpacingHighlight = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(132, 41, 41, 0.5)',
    });

    private static betweenSentenceSpacingHighlight = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(132, 41, 41, 0.5)',
    });

    async update(editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        const wsMatchGroup = 'whitespace';
        
        const document = editor.document;
        const text = document.getText();
        const sentenceWhitespaceLengths: [ number, vscode.Range ][] = [];

        let prevRangeStart: vscode.Position = new vscode.Position(0, 0);
        const sentenceRanges: vscode.Range[] = [];

        const sentenceStopRegex = new RegExp(`${punctuationStopsReg.source}+(?<${wsMatchGroup}>\\s*)`, 'gi');
        let matchArr: RegExpExecArray | null;
        while ((matchArr = sentenceStopRegex.exec(text)) !== null) {
            const match: RegExpExecArray = matchArr!;
            const whitespace = match.groups?.[wsMatchGroup];
            if (!whitespace) continue;

            if (whitespace.length > 0) {
                const sentenceWhitspaceStart = match[0].indexOf(whitespace);
                const sentenceWhitespaceEnd  = sentenceWhitspaceStart + whitespace.length;
                sentenceWhitespaceLengths.push([ whitespace.length, new vscode.Range(
                    document.positionAt(sentenceWhitspaceStart),
                    document.positionAt(sentenceWhitespaceEnd)
                ) ]);
            }

            const nextPrevRangeStart = document.positionAt(match.index);
            sentenceRanges.push(new vscode.Range(prevRangeStart, nextPrevRangeStart));
            prevRangeStart = nextPrevRangeStart;
        }
        sentenceRanges.push(new vscode.Range(prevRangeStart, document.positionAt(text.length)));

        const innerSentenceDoubleSpacing: vscode.Range[] = [];
        for (const range of sentenceRanges) {
            const sentence = document.getText(range);
            if (/^\s*$/.test(sentence)) {
                continue;
            }

            let multipleSpaceMatchArr: RegExpExecArray | null;
            while ((multipleSpaceMatchArr = /\s{2,}/g.exec(sentence)) !== null) {
                const multipleSpaceMatch: RegExpExecArray = multipleSpaceMatchArr;
                
                const start = document.offsetAt(range.start) + multipleSpaceMatch.index;
                const end   = start + multipleSpaceMatch[0].length;
                innerSentenceDoubleSpacing.push(new vscode.Range(
                    document.positionAt(start),
                    document.positionAt(end)
                ));
            }
        }
        editor.setDecorations(SpacingHighlights.innerSentenceSpacingHighlight, innerSentenceDoubleSpacing);

        if (sentenceWhitespaceLengths.length === 0) {
            return;
        }

        const whitespaceLengthCounts: Record<number, number> = {};
        sentenceWhitespaceLengths.forEach(([ wlLength, _ ]) => {
            if (wlLength in whitespaceLengthCounts) {
                whitespaceLengthCounts[wlLength]++;
            }
            else {
                whitespaceLengthCounts[wlLength] = 1;
            }
        });

        const sortedWhitelengthCounts = Object.entries(whitespaceLengthCounts).sort((a, b) => {
            return b[1] - a[1];
        });

        const [ mostCommonWhiteLength, mostCommonWhiteLengthCount ] = sortedWhitelengthCounts[0];
        if (mostCommonWhiteLengthCount / sentenceWhitespaceLengths.length < 0.8) {
            return;
        }

        // All other whitespaces should be highlighted
        const nonMostCommonWhitespaceRanges = sentenceWhitespaceLengths.map(([ whitespaceLength, whitespaceRange ]) => {
            if (whitespaceLength !== parseInt(mostCommonWhiteLength)) {
                return whitespaceRange;
            }
            return [];
        }).flat();
        editor.setDecorations(SpacingHighlights.betweenSentenceSpacingHighlight, nonMostCommonWhitespaceRanges);
    }
}