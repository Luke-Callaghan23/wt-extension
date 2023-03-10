import { clear } from 'console';
import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { Workspace } from '../workspace/workspace';
import { Timed } from '../timedView';
import * as extension from '../extension';

class Ranks {
    public rankedWords: { [index: string]: Word[] };
    public orderedRanks: [ number, Word[] ][];

    constructor (words: Word[]) {
        // Iterate words and map each word's text to all occurrences of that word
        this.rankedWords = {};
        for (const word of words) {
            const { text } = word;
            if (this.rankedWords[text]) {
                this.rankedWords[text].push(word);
            }
            else {
                this.rankedWords[text] = [ word ];
            }
        }

        // Arange each word into `(count, wordText)` tuples, ordered by `count`, descending
        // First create un ordered ranks by iterating over each each array of occurrences, and creating tuples
        this.orderedRanks = [];
        for (const [ _, words ] of Object.entries(this.rankedWords)) {
            const count = words.length;
            this.orderedRanks.push([ count, words ]);
        }
        // Sort tuples descending
        this.orderedRanks.sort((a, b) => b[0] - a[0]);
    }

    // Modifiers to give higher precedence to 'closer' words
    static readonly sentenceModifier = 10.0;
    static readonly paragraphModifier = 1.5;
    static readonly fullViewModifier = 0.75;

    // Lower bound for instance count of each word to assign a rating
    static readonly sentenceLowerBound = 2;
    static readonly paragraphLowerBound = 2;
    static readonly fullViewLowerBound = 4;

    static assignRatings (fullView: VisibleData, paragraphs: Paragraph[], sentences: Sentence[]): 
        [ Word[], Word[] | undefined, Word[] | undefined, Word[] | undefined ] | null 
    {
        // Combine the ranks for each word in sentences and paragraphs with all the words in the
        //      full view

        // Iterate over every unique word in the view of the editor and assign that word a "rating"
        // Hard to explain, but essentially the rating of every word will increase with every instance
        //      of that word
        // The rating will increase more if the words are more densely populated
        //      As in, two instances of the same word in the same sentence gets a higher rating than
        //          two instances of another word in the same paragraph
        //      But, two instances of the same word in the same paragraph still gets a higher rating than 
        //          two instances of another word in the whole view
        //      (case in point, see how annoying it is to read the word 'same' over and over again, in the 
        //      comment above)
        // Ratings are summed, so if there are enough instances of the same word in the full view, that
        //      will eventually outweigh 2 or 3 instance of the same word in the same sentence
        // The idea is that having the same word appear 5 times in a paragraph is more egregious than 
        //      2 times in the same sentence, and the same word appearing in the same 'view' 10 times is more
        //      egregious than 5 times in the same paragraph, etc.
        const rated: ([ number, Word[] ] | null)[] = fullView.uniqueWords.map(target => {
            // Assign paragraph ratings for this word
            const para: number = paragraphs.reduce((acc, paragraph) => {
                const wordInstances: Word[] | undefined = paragraph.ranks.rankedWords[target];
                if (wordInstances === undefined) return acc;
                return (acc + wordInstances.length - 1) * this.paragraphModifier;
            }, 0);

            // Assign sentence ratings for this word
            const sent: number = sentences.reduce((acc, sentence) => {
                const wordInstances: Word[] | undefined = sentence.ranks.rankedWords[target];
                if (wordInstances === undefined) return acc;
                return (acc + wordInstances.length - 1) * this.sentenceModifier;
            }, 0);

            // Assign 'view' ratings for this word
            const allInstances: Word[] = fullView.ranks.rankedWords[target];
            const full = allInstances.length * this.fullViewModifier;

            // Final test to make sure that this word should be rated
            // If the instance count of this word does not meet any of the lower bounds, then this word
            //      should not be considered for assigning a rating
            if (para < Ranks.paragraphLowerBound && sent < Ranks.sentenceLowerBound && full < Ranks.fullViewLowerBound) {
                return null;
            }
            
            // If this word passed all lower bound checks, then return the rating of the word alongside all isntances
            //      of that word
            const rating = para + sent + full;
            return [ rating, allInstances ];
        });
        
        // Filter out nulls
        const finalRatings: [ number, Word[] ][] = rated.filter(rating => rating) as [number, Word[]][];
        if (finalRatings.length === 0) return null;
        
        // Sort the rated words in descending order
        finalRatings.sort((a, b) => b[0] - a[0]);

        // Destructure the top four rated word from the ratings and return them
        const first: [ number, Word[] ] = finalRatings[0];
        const second: [ number, Word[] ] | undefined = finalRatings[1];
        const third: [ number, Word[] ] | undefined = finalRatings[2];
        const fourth: [ number, Word[] ] | undefined = finalRatings[3];

        return [
            first[1],
            second?.[1],
            third?.[1],
            fourth?.[1]
        ];

    }
};

class Word {
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

    private static filtered: RegExp[] = [ 
        // Common words
        /a/, /the/, /of/, /i/, 

        // Whitespace
        /\s+/, 

        // Empty string
        /^$/, 

        // Any single character non-alphanumberic character
        /[^a-zA-Z0-9]/ 
    ];
    static shouldFilterWord ({ text }: Word): boolean {
        return Word.filtered.find(filt => filt.test(text)) !== undefined;
    }
}

class Sentence {
    public allWords: Word[];
    public range: vscode.Range;
    public ranks: Ranks;

    constructor (
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

            if (!Word.shouldFilterWord(word)) {
                // Push the sentence, and all its words to this object
                this.allWords.push(word);
            }

            // Move the last end index forward to the end of the sentence separator
            lastEnd = matched.index + matched[0].length;
        }

        this.ranks = new Ranks(this.allWords);
    }
}

class Paragraph {
    public range: vscode.Range;
    public sentences: Sentence[];
    public allWords: Word[];
    public ranks: Ranks;

    constructor (
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
                editor,
                fullText, sentenceText,
                start, end
            );

            // Push the sentence, and all its words to this object
            this.sentences.push(sentence);
            this.allWords.push(...sentence.allWords);

            // Move the last end index forward to the end of the sentence separator
            lastEnd = matched.index + matched[0].length;
        }
        this.ranks = new Ranks(this.allWords);
    }
}

class VisibleData {
    public paragraphs: Paragraph[];
    public allWords: Word[];
    public ranks: Ranks;
    public uniqueWords: string[];

    constructor (
        editor: vscode.TextEditor,
        visible: vscode.Range,
    ) {
        this.allWords = [];
        this.paragraphs = [];
        
        const text = editor.document.getText();
        const visibleStart: number = editor.document.offsetAt(visible.start);
        const visibleEnd: number = editor.document.offsetAt(visible.end);
        let visibleText = text.substring(visibleStart, visibleEnd);
        
        // Iterate over every match of the 
        let lastEnd = 0;
        let match: RegExpExecArray | null;

        // Add extra paragraph separator to the para text in order to force an extra match for the last paragraph
        // (Adding '$' to the para separator regex to match the end of the string breaks everything, so as a 
        //      workaround the extra separator is added)
        visibleText += '\n\n';
        while ((match = extension.paragraphSeparator.exec(visibleText))) {
            const matched: RegExpExecArray = match;

            // Get start and end indeces of the paragraph
            // Where start and end are indexed with visibleStart as 0 
            const startOff = lastEnd;
            const endOff = matched.index;
            const paragraphText = visibleText.substring(startOff, endOff);

            // Get absolute start and end of the paragraph
            const start = startOff + visibleStart;
            const end = endOff + visibleStart;

            // Skip the paragraph if it's empty
            if (startOff === endOff || startOff === endOff + 1) continue;
            if (/^\s*$/.test(paragraphText)) continue;          // tests if paragraph is only whitespace

            // Create a paragraph object
            const paragraph = new Paragraph(
                editor, 
                text, paragraphText,
                start, end
            );

            // Push the paragraph to this data structure, and concat all its words
            this.paragraphs.push(paragraph);
            this.allWords.push(...paragraph.allWords);

            // Move the last end index forward to the end of the paragraph separator
            lastEnd = matched.index + matched[0].length;
        }
        this.ranks = new Ranks(this.allWords);

        // Get all the unique words text
        const uniqueMap: { [index: string]: boolean } = {};
        this.allWords.forEach(({ text }) => uniqueMap[text] = true);
        this.uniqueWords = Object.keys(uniqueMap);
    }
}


export class Proximity implements Timed {
    enabled: boolean;
    constructor (
        context: vscode.ExtensionContext,
        workspace: Workspace
    ) {
        this.enabled = true;
    }


    async updateDecorationsForWord (
        editor: vscode.TextEditor, 
        word: Word[],
        decorations: vscode.TextEditorDecorationType
    ) {
        const wordRanges: vscode.Range[] = word.map(({ range }) => range)
        editor.setDecorations(decorations, wordRanges);
    }

    async update (editor: vscode.TextEditor): Promise<void> {

        // Index used to indicate the place in Proximity.decorators to start clearing decorations
        // In the case where `x` decorators were used in the last update but `x - n` decorators need
        //      to be used during this update then we need to clear the last `n` decorators in this
        //      update
        let clearIndex = -1;
        for (const visible of editor.visibleRanges) {
            // Get ratings ffor all words in the current visible range
            const visibleData = new VisibleData(editor, visible);
            const rated = Ranks.assignRatings(
                visibleData,                                            // full view
                visibleData.paragraphs,                                 // all paragraphs
                visibleData.paragraphs.map(p => p.sentences).flat()     // all sentences
            );

            // If there are no available ratings, indicate that all decorators need to be cleared, and continue
            if (!rated) {
                clearIndex = 0;
                continue;
            }
            
            rated.forEach((r, index) => {
                // If we found an undefined rating, then clear all decorators after it
                if (!r) {
                    if (clearIndex === -1) clearIndex = index;
                    return;
                }
                const decorator = Proximity.decorators[index];
                this.updateDecorationsForWord(editor, r, decorator);
            });
        }

        // Clear unused decorators
        if (clearIndex !== -1) {
            Proximity.decorators.slice(clearIndex).forEach(dec => {
                editor.setDecorations(dec, []);
            });
        }

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


    // 
    async disable? (): Promise<void> {
        // Simply clear all four of the proximity decorators
        if (!vscode.window.activeTextEditor) return;
        const editor = vscode.window.activeTextEditor;
        Proximity.decorators.forEach(decoratorType => {
            editor.setDecorations(decoratorType, []);
        });
    }
}