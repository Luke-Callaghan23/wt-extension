import * as vscode from 'vscode';
import { Proximity } from './proximity';
import { Ranks } from './ranks';
import * as extension from '../extension';

export class Word {
    public text: string;
    public range: vscode.Range;
    
    constructor (
        editor: vscode.TextEditor,
        fullText: string,
        wordText: string,
        start: number,
        end: number,
    ) {
        let scratchPad = wordText.toLocaleLowerCase();
        let scratchPadLength = scratchPad.length;
        
        // Get length of whitespace in start
        scratchPad = scratchPad.trimStart();
        let startWhitespace = scratchPadLength - scratchPad.length;
        scratchPadLength = scratchPad.length;

        // Get length of whitespace in end
        scratchPad = scratchPad.trimEnd();
        let endWhitespace = scratchPadLength - scratchPad.length;

        this.text = scratchPad;

        // Create range with start and end whitespace markers in mind
        const startPosition = editor.document.positionAt(start + startWhitespace);
        const endPosition = editor.document.positionAt(end - endWhitespace);
        const range = new vscode.Range(startPosition, endPosition);
        this.range = range;
    }
}

export class Sentence {
    public allWords: Word[];
    public range: vscode.Range;
    public ranks: Ranks;

    constructor (
        proximity: Proximity,
        editor: vscode.TextEditor,
        fullText: string,
        sentenceText: string,
        sentenceStart: number,
        sentenceEnd: number,
    ) {
        this.allWords = [];
        this.range = new vscode.Range(
            editor.document.positionAt(sentenceStart),
            editor.document.positionAt(sentenceEnd)
        );
        
        let lastEnd = 0;
        let match: RegExpExecArray | null;

        // Add extra word separator to the sentence text in order to force an extra match for the last word
        // (Adding '$' to the word separator regex to match the end of the string breaks everything, so as a 
        //      workaround the extra separator is added)
        sentenceText += ' ';
        while ((match = extension.wordSeparatorRegex.exec(sentenceText))) {
            const matched: RegExpExecArray = match;

            // Get start and end indeces of the sentence
            // Where start and end are indexed with paragraph as 0 
            const startOff = lastEnd;
            const endOff = matched.index;
            const wordText = sentenceText.substring(startOff, endOff);

            // Get absolute start and end of the paragraph
            const start = startOff + sentenceStart;
            const end = endOff + sentenceStart;

            // Skip the sentence if it's empty
            if (startOff === endOff || startOff === endOff + 1) continue;
            if (/^\s*$/.test(sentenceText)) continue;                           // tests if the sentence is only whitespace

            // Create sentence and push it to this paragraph's structure
            const word = new Word(
                editor,
                fullText,
                wordText,
                start, end
            );

            if (!proximity.shouldFilterWord(word)) {
                // Push the sentence, and all its words to this object
                this.allWords.push(word);
            }

            // Move the last end index left to the end of the sentence separator
            lastEnd = matched.index + matched[0].length;
        }

        this.ranks = new Ranks(this.allWords);
    }
}

export class Paragraph {
    public range: vscode.Range;
    public sentences: Sentence[];
    public allWords: Word[];
    public ranks: Ranks;

    constructor (
        proximity: Proximity,
        editor: vscode.TextEditor,
        fullText: string,
        paragraphText: string,
        paragraphStart: number,
        paragraphEnd: number,
    ) {
        
        this.allWords = [];
        this.sentences = [];
        this.range = new vscode.Range(
            editor.document.positionAt(paragraphStart),
            editor.document.positionAt(paragraphEnd)
        );
        
        let lastEnd = 0;
        let match: RegExpExecArray | null;
        
        // Add extra sentence separator to the sentence text in order to force an extra match for the last paragraph
        // (Adding '$' to the sentence separator regex to match the end of the string breaks everything, so as a 
        //      workaround the extra separator is added)
        paragraphText += '!';
        while ((match = extension.sentenceSeparator.exec(paragraphText))) {
            const matched: RegExpExecArray = match;

            // Get start and end indeces of the sentence
            // Where start and end are indexed with paragraph as 0 
            const startOff = lastEnd;
            const endOff = matched.index;
            const sentenceText = paragraphText.substring(startOff, endOff);

            // Get absolute start and end of the paragraph
            const start = startOff + paragraphStart;
            const end = endOff + paragraphStart;

            // Skip the sentence if it's empty
            if (startOff === endOff || startOff === endOff + 1) continue;
            if (/^\s*$/.test(sentenceText)) continue;                           // tests if the sentence is only whitespace

            // Create sentence and push it to this paragraph's structure
            const sentence = new Sentence(
                proximity,
                editor,
                fullText, sentenceText,
                start, end
            );

            // Push the sentence, and all its words to this object
            this.sentences.push(sentence);
            this.allWords.push(...sentence.allWords);

            // Move the last end index left to the end of the sentence separator
            lastEnd = matched.index + matched[0].length;
        }
        this.ranks = new Ranks(this.allWords);
    }
}

