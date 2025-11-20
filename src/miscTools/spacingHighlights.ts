import * as vscode from 'vscode';
import { Timed } from '../timedView';
import { fragmentStopReg, punctuationStopsReg } from '../editor/jumps';

export class SpacingHighlights implements Timed {
    enabled: boolean;
    constructor () { this.enabled = true; }
    getUpdatesAreVisible(): boolean { return this.enabled; }


    
    private static incorrectInnerSentenceSpaceHighlight = vscode.window.createTextEditorDecorationType({
        backgroundColor: "rgba(128,32,32,0.6)",
    });

    // NOTE: need two decorations for this because the logic in the update method would get complicated if
    //      we were unable to exit early
    // Also allows for potential where we can make these two different colors in the future
    private static incorrectTrailingSpaceHighlight = vscode.window.createTextEditorDecorationType({
        backgroundColor: "rgba(128,32,32,0.6)",
    });

    async update(editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        const wsMatchGroup = 'whitespace';
        
        const document = editor.document;
        const text = document.getText();
        const sentenceTrailingWhitespaceLengths: [ number, vscode.Range ][] = [];

        const sentenceRanges: vscode.Range[] = [];

        // Regex to match ends of sentences as well as the trailing whitespace after it
        const sentenceStopRegex = new RegExp(`${punctuationStopsReg.source}+(?<${wsMatchGroup}>[\\n\\s]*)`, 'gi');

        // Collect all sentences in the document, taking a note of their ranges and the whitespace that trails them
        let prevRangeStart = document.positionAt(0);
        let matchArr: RegExpExecArray | null;
        while ((matchArr = sentenceStopRegex.exec(text)) !== null) {
            const match: RegExpExecArray = matchArr!;
            const whitespace = match.groups?.[wsMatchGroup];

            // If there is trailing whitespace track its length and position in the document
            //      and store it in sentenceTrailingWhitespaceLengths
            if (whitespace && whitespace.length > 0) {
                const sentenceWhitspaceStart = match.index + match[0].indexOf(whitespace);
                const sentenceWhitespaceEnd  = sentenceWhitspaceStart + whitespace.length;
                sentenceTrailingWhitespaceLengths.push([ whitespace.length, new vscode.Range(
                    document.positionAt(sentenceWhitspaceStart),
                    document.positionAt(sentenceWhitespaceEnd)
                ) ]);
            }

            // Store the location of the sentence itself
            const nextPrevRangeStart = document.positionAt(match.index);
            sentenceRanges.push(new vscode.Range(prevRangeStart, nextPrevRangeStart));

            // match[0].length -> length of the punctuation + trailing whitespace
            // Setting "previous range start" to the location of the match + the length of the punc + ws
            //      essentially moves the NEXT range for the NEXT sentence forward far enough that the 
            //      punc + ws of this sentence are not considered part of that sentence
            prevRangeStart = document.positionAt(match.index + match[0].length);
        }
        sentenceRanges.push(new vscode.Range(prevRangeStart, document.positionAt(text.length)));

        // Check INSIDE of each sentence for spacing issues
        const innerSentenceDoubleSpacing: vscode.Range[] = [];
        for (const range of sentenceRanges) {

            // Collect the sentence
            const sentence = document.getText(range);
            if (/^\s*$/.test(sentence)) {
                // Skip fully whitespace sentences
                // Not sure if this ever happens
                continue;
            }

            // Now, inside of the sentence text, search for any double spacing
            let multipleSpaceMatchArr: RegExpExecArray | null;
            const doubleSpaceRegex = /\s{2,}/g;
            while ((multipleSpaceMatchArr = doubleSpaceRegex.exec(sentence)) !== null) {
                const multipleSpaceMatch: RegExpExecArray = multipleSpaceMatchArr;
                
                // Get offset of the sentence + the index inside of that sentence of the double space
                const start = document.offsetAt(range.start) + multipleSpaceMatch.index;
                const end = start + multipleSpaceMatch[0].length;
                innerSentenceDoubleSpacing.push(new vscode.Range(
                    document.positionAt(start),
                    document.positionAt(end)
                ));
            }
        }
        editor.setDecorations(SpacingHighlights.incorrectInnerSentenceSpaceHighlight, innerSentenceDoubleSpacing);

        if (sentenceTrailingWhitespaceLengths.length === 0) {
            return;
        }

        // Get a count of each length of trailing whitespace for each sentence
        const trailingWhitespaceLengthCounts: Record<number, number> = {};
        sentenceTrailingWhitespaceLengths.forEach(([ wlLength, _ ]) => {
            if (wlLength in trailingWhitespaceLengthCounts) {
                trailingWhitespaceLengthCounts[wlLength]++;
            }
            else {
                trailingWhitespaceLengthCounts[wlLength] = 1;
            }
        });

        // Sort the instance counts of trailing whitespace lengths, descending
        const sortedTrailingWhitelengthCounts = Object.entries(trailingWhitespaceLengthCounts).sort((a, b) => {
            return b[1] - a[1];
        });

        // Get the most common sentence trailing whitespace length
        // And check if that instance is greater than 80% of all trailing whitespace in the document
        const [ mostCommonWhiteLength, mostCommonWhiteLengthCount ] = sortedTrailingWhitelengthCounts[0];
        if (mostCommonWhiteLengthCount / sentenceTrailingWhitespaceLengths.length < 0.8) {
            // If this instance is not overwhelmingly the most common whitepace length in the document
            //      then don't bother adding any highlighting
            return;
        }

        // Any instance of trailing whitespace that is NOT the overwhelmingly most common one, then 
        //      add the highlights
        const nonMostCommonWhitespaceRanges: vscode.Range[] = sentenceTrailingWhitespaceLengths.map(([ whitespaceLength, whitespaceRange ]) => {
            if (whitespaceLength !== parseInt(mostCommonWhiteLength)) {
                return whitespaceRange;
            }
            return [];
        }).flat();
        editor.setDecorations(SpacingHighlights.incorrectTrailingSpaceHighlight, nonMostCommonWhitespaceRanges);
    }
}