import * as vscode from 'vscode';
import { Paragraph, Sentence, Word } from './wordStructures';


export class Ranks {
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

    // Lower bound for instance count of each word to assign a rating
    static readonly sentenceLowerBound = 2;
    static readonly paragraphLowerBound = 2;

    static assignRatings (uniqueWords: string[], allWords: Word[], paragraphs: Paragraph[], sentences: Sentence[]): 
        [ Word[], Word[] | undefined, Word[] | undefined, Word[] | undefined ] | null 
    {

        const ranks = new Ranks(allWords);

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
        const rated: ([ number, Word[] ] | null)[] = uniqueWords.map(target => {
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
            const allInstances: Word[] = ranks.rankedWords[target];

            // Final test to make sure that this word should be rated
            // If the instance count of this word does not meet any of the lower bounds, then this word
            //      should not be considered for assigning a rating
            if (para < Ranks.paragraphLowerBound && sent < Ranks.sentenceLowerBound) {
                return null;
            }
            
            // If this word passed all lower bound checks, then return the rating of the word alongside all isntances
            //      of that word
            const rating = para + sent;
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
