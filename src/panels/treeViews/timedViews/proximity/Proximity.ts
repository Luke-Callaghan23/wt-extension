import * as vscode from 'vscode';
import * as console from '../../../../vsconsole';
import { Workspace } from '../../../../workspace/workspace';
import { Timed } from '../timedView';
import * as extension from './../../../../extension';

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
        const startPosition = editor.document.positionAt(start);
        const endPosition = editor.document.positionAt(end);
        const range = new vscode.Range(startPosition, endPosition);
        this.range = range;
        this.text = wordText;
    }
}

class Sentence {
    public allWords: Word[];
    public range: vscode.Range;

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

            // Push the sentence, and all its words to this object
            this.allWords.push(word);

            // Move the last end index forward to the end of the sentence separator
            lastEnd = matched.index + matched[0].length + 1;
        }
    }
}

class Paragraph {
    public range: vscode.Range;
    public sentences: Sentence[];
    public allWords: Word[];

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
            lastEnd = matched.index + matched[0].length + 1;
        }
    }
}

class VisibleData {
    public paragraphs: Paragraph[];
    public allWords: Word[];

    constructor (
        editor: vscode.TextEditor,
        visible: vscode.Range,
    ) {
        this.allWords = [];
        this.paragraphs = [];
        
        const text = editor.document.getText();
        const visibleStart: number = editor.document.offsetAt(visible.start);
        const visibleEnd: number = editor.document.offsetAt(visible.end);
        const visibleText = text.substring(visibleStart, visibleEnd);
        
        // Iterate over every match of the 
        let lastEnd = 0;
        let match: RegExpExecArray | null;
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
            lastEnd = matched.index + matched[0].length + 1;
        }
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

    async update (editor: vscode.TextEditor): Promise<void> {

        const fullText = editor.document.getText();
        for (const visible of editor.visibleRanges) {
            const visibleData = new VisibleData(editor, visible);
        }


        throw new Error('Method not implemented.');
    }

    private static commonDecorations = {
		borderWidth: '1px',
        borderRadius: '3px',
		borderStyle: 'solid',
		overviewRulerColor: 'blue',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	};
    
    private static primary = vscode.window.createTextEditorDecorationType({
        ...this.commonDecorations,
        backgroundColor: 'rgb(161, 8, 8, 0.3)',
        borderColor: 'rgb(161, 8, 8, 0.3)',
    });
    private static secondary = vscode.window.createTextEditorDecorationType({
        ...this.commonDecorations,
        backgroundColor: 'rgb(161, 8, 8, 0.3)',
        borderColor: 'rgb(161, 8, 8, 0.3)',
    });
    private static tertiary = vscode.window.createTextEditorDecorationType({
        ...this.commonDecorations,
        backgroundColor: 'rgb(161, 8, 8, 0.3)',
        borderColor: 'rgb(161, 8, 8, 0.3)',
    });
    private static fourth = vscode.window.createTextEditorDecorationType({
        ...this.commonDecorations,
        backgroundColor: 'rgb(161, 8, 8, 0.3)',
        borderColor: 'rgb(161, 8, 8, 0.3)',
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