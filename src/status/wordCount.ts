import * as vscode from 'vscode';
import * as console from './../vsconsole';

export class WordCount {
    wordCountStatus: vscode.StatusBarItem;
    constructor () {
        this.wordCountStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
        this.wordCountStatus.command = 'wt.wordCount.showWordCountRules';

        vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => this.updateWordCount(doc));
        
        // Set the initial value for the word count
        const currentDoc = vscode.window.activeTextEditor?.document;
        if (currentDoc) {
            this.updateWordCount(currentDoc);
        }
    }

    private static nonAlphanumeric = /[^a-zA-Z0-9]+/g;
    private updateWordCount (document: vscode.TextDocument) {
        // Only update if the saved document was the same document in the active editor
        // I *think* this is always true, but who cares -- this extension is already inefficient as
        //      hell anyways
        const activeDoc = vscode.window.activeTextEditor?.document;
        if (!activeDoc || activeDoc.uri.toString() !== document.uri.toString()) {
            return;
        }

        // Get the word count of the document by splitting on non-alphanumeric characters
        //      (greedy) and count the split array length
        const fullText = document.getText();
        const words = fullText.split(WordCount.nonAlphanumeric);
        this.wordCountStatus.text = `Word Count: ${words.length}`;
        this.wordCountStatus.show();
    }

    private registerCommands () {
        vscode.commands.registerCommand('wt.wordCount.showWordCountRules', () => {
            vscode.window.showInformationMessage(
                "Word Count Rules",
                {
                    modal: true,
                    detail: "Word count gets updated on every save to prevent redundancy.  Rules for a what is counted as a word is simple.  Every segment of alphanumeric text that is delimited by non-alphanumeric text is considered a word."
                }
            )
        })
    } 
}