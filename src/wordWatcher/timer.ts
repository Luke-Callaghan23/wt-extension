
import * as vscode from 'vscode';
import * as extension from './../extension';
import { WordWatcher } from './wordWatcher';

// Decoration for watched words
const watchedWordDecoration = vscode.window.createTextEditorDecorationType({
    borderWidth: '1px',
    borderRadius: '3px',
    borderStyle: 'solid',
    overviewRulerColor: 'rgb(161, 8, 8, 0.3)',
    backgroundColor: 'rgb(161, 8, 8, 0.3)',
    borderColor: 'rgb(161, 8, 8, 0.3)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
});

export async function update (this: WordWatcher, editor: vscode.TextEditor): Promise<void> {

    const activeEditor = vscode.window.activeTextEditor;
    
    // Create a single regex for all words in this.words
    // TOTEST: does this prevent substring matching?

    let watchedAndEnabled: string[];
    let regexString: string;
    let regex: RegExp;
    let unwatchedRegeces: RegExp[];
    if (this.wasUpdated || !this.lastCalculatedRegeces) {
        // Filter out the disabled words
        watchedAndEnabled = this.watchedWords.filter(watched => !this.disabledWatchedWords.find(disabled => watched === disabled));

        // Create the regex string from the still-enabled watched words
        regexString = extension.wordSeparator + watchedAndEnabled.join(`${extension.wordSeparator}|${extension.wordSeparator}`) + extension.wordSeparator;
        regex = new RegExp(regexString, 'g');
        unwatchedRegeces = this.unwatchedWords.map(unwatched => new RegExp(`${extension.wordSeparator}${unwatched}${extension.wordSeparator}`));

        this.lastCalculatedRegeces = {
            watchedAndEnabled,
            regexString,
            regex,
            unwatchedRegeces
        };
    }
    else {
        watchedAndEnabled = this.lastCalculatedRegeces.watchedAndEnabled;
        regexString = this.lastCalculatedRegeces.regexString;
        regex = this.lastCalculatedRegeces.regex;
        unwatchedRegeces = this.lastCalculatedRegeces.unwatchedRegeces;
    }
    this.wasUpdated = false;

    const text = editor.document.getText();
    
    // While there are more matches within the text of the document, collect the match selection
    const matched: vscode.DecorationOptions[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
        const matchReal: RegExpExecArray = match;

        // Skip if the match also matches an unwatched word
        if (unwatchedRegeces.find(re => re.test(matchReal[0]))) {
            continue;
        }

        let start: number = match.index;
        if (match.index !== 0) {
            start += 1;
        }
        let end: number = match.index + match[0].length;
        if (match.index + match[0].length !== text.length) {
            end -= 1;
        }
        const startPos = editor.document.positionAt(start);
        const endPos = editor.document.positionAt(end);
        const decoration = { 
            range: new vscode.Range(startPos, endPos), 
            hoverMessage: '**' + match[0] + '**' 
        };
        matched.push(decoration);
        regex.lastIndex -= 1;
    }
    editor.setDecorations(watchedWordDecoration, matched);
}



export async function disable(this: WordWatcher): Promise<void> {
    this.allDecorationTypes.forEach(dec => {
        vscode.window.activeTextEditor?.setDecorations(dec, []);
    })
}