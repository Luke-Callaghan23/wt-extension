import * as vscode from 'vscode';
import * as extension from './../extension';
import { WordWatcher } from './wordWatcher';
import { TimedView } from '../timedView';
import { Workspace } from '../workspace/workspaceClass';

export function addOrDeleteTargetedWord (
    this: WordWatcher,
    operation: 'add' | 'delete' | 'replace',
    target: string,
    contextItem: 'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.excludedWords' | 'wt.wordWatcher.disabledWatchedWords',
    replaceIndex?: number,
    preventRefresh: boolean = false,
) {

    if (replaceIndex === undefined || replaceIndex === null) {
        replaceIndex = -1;
    }

    // Get the targeted array, depending on the context that this updateWords function call was made in
    let targetArray: string[];
    if (contextItem === 'wt.wordWatcher.watchedWords') {
        targetArray = this.watchedWords;
    }
    else if (contextItem === 'wt.wordWatcher.excludedWords') {
        targetArray = this.excludedWords;
    }
    else if (contextItem === 'wt.wordWatcher.disabledWatchedWords') {
        targetArray = this.disabledWatchedWords;
    }
    else {
        throw new Error(`Not possible -- context item '${contextItem}' is invalid`);
    }

    // Either add or remove the target word from the target array, depending on the opration
    if (operation === 'add') {
        targetArray.push(target);
    }
    else if (operation === 'delete') {
        const targetIndex = targetArray.findIndex(item => item === target);
        if (targetIndex === -1) {
            vscode.window.showErrorMessage(`Error could not find '${target}' in '${contextItem}'`);
            return;
        }
        targetArray.splice(targetIndex, 1);
    }
    else if (operation === 'replace' && replaceIndex >= 0) {
        const originalWord = targetArray[replaceIndex];
        targetArray[replaceIndex] = target;
        if (this.wordColors[originalWord]) {
            this.wordColors[target] = this.wordColors[originalWord];
            delete this.wordColors[originalWord];
        }
    }
    else {
        throw new Error(`Not possible -- operation '${operation}' is invalid`);
    }
    
    // Do updates 
    this.wasUpdated = true;
    Workspace.forcePackaging(this.context, contextItem, targetArray);
    for (const editor of vscode.window.visibleTextEditors) {
        this.update(editor, TimedView.findCommentedRanges(editor));
    }
    
    if (!preventRefresh) {
        this.refresh(
            operation === 'add' && contextItem === 'wt.wordWatcher.excludedWords'
                ? target 
                : undefined
        );
    }
    else {
        this.tree = this.initializeTree();
    }
}

export async function addWordToWatchedWords (this: WordWatcher, options: {
    watchedOrExcluded: 'watched' | 'excluded',
    insertOrReplace: 'insert'
} | {
    watchedOrExcluded: 'watched',
    insertOrReplace: 'replace',
    placeholder: string,
    value: string,
}): Promise<string | null> {

    while (true) {
        
        let response: string | undefined;
        if (options.insertOrReplace === 'replace') {
            response = await vscode.window.showInputBox({
                placeHolder: options.placeholder,
                value: options.value,
                ignoreFocusOut: false,
                prompt: `Enter the replacement value for '${options.value}' (NOTE: this must be parsable as a regex!)`,
                title: 'Replace word'
            });
        }
        else if (options.watchedOrExcluded === 'watched') {
            response = await vscode.window.showInputBox({
                ignoreFocusOut: false,
                prompt: `Enter the word or word pattern that you would like to highlight in text (NOTE: this must be parsable as a regex!)`,
                title: 'Add Watched Word'
            });
        }
        else if (options.watchedOrExcluded === 'excluded') {
            response = await vscode.window.showInputBox({
                ignoreFocusOut: false,
                prompt: `Enter the word you'd like to stop watching`,
                title: 'Add Word Exclusion'
            });
        }
        if (!response) return null;

        const targetWords = options.watchedOrExcluded === 'watched'
            ? this.watchedWords
            : this.excludedWords;

        // Check if the word is already in the word list
        if (targetWords.find(existing => existing === response)) {
            const proceed = await vscode.window.showInformationMessage(`Word '${response}' already in list of ${options.watchedOrExcluded} words!`, {
                modal: true
            }, 'Submit Again', 'Cancel');
            if (proceed === 'Cancel') return null;
            continue;
        }

        try {
            new RegExp(response)
        }
        catch (err: any) {
            const proceed = await vscode.window.showInformationMessage(`Could not parse specified word/pattern!`, {
                modal: true,
                detail: `Response was not parsable as a regex!  Retrieved this error: '${err}'`
            }, 'Submit Again', 'Cancel');
            if (proceed === 'Cancel') return null;
            continue;
        }


        if (options?.insertOrReplace === 'insert') {
            // If the word is valid and doesn't already exist in the word list, then continue adding the words
            this.updateWords('add', response, options.watchedOrExcluded === 'watched' ? 'wt.wordWatcher.watchedWords' : 'wt.wordWatcher.excludedWords');
        }
        return response;
    }
    return null;
}

export async function jumpNextInstanceOfWord (this: WordWatcher, word: string) {
    if (!vscode.window.activeTextEditor) return;
    const activeEditor: vscode.TextEditor = vscode.window.activeTextEditor

    // If the word is disabled, then leave
    if (this.disabledWatchedWords.find(disabled => disabled === word)) return;


    if (word === this.lastJumpWord) {
        // If the jumped word is the same one as the last search, then increment the last jump instance
        this.lastJumpInstance = this.lastJumpInstance + 1;
    }
    else {
        // Otherwise, search for the first instance of the provided word
        this.lastJumpInstance = 1;
        this.lastJumpWord = word;
    }

    // Create a single regex for all words in this.words
    const regEx = new RegExp(`${extension.wordSeparator}${word}${extension.wordSeparator}`, 'gi');

    // If there were no updates to any of the watched/uwatched words since the last time
    //      they were calculated, then use the excludedRegeces RegExp array from there
    let excludedRegeces: RegExp[];
    if (!(this.wasUpdated || !this.lastCalculatedRegeces)) {
        excludedRegeces = this.lastCalculatedRegeces.excludedRegeces;
    }
    else {
        // Otherwise, calculate the array of excluded regeces
        excludedRegeces = this.excludedWords.map(excluded => new RegExp(`${extension.wordSeparator}${excluded}${extension.wordSeparator}`, 'gi'));
    }
    
    const text = activeEditor.document.getText();
    let startPos, endPos;
    let matchIndex = 0;
    while (true) {
        // Match the text for the selected word, as long as the match index is less than the targeted 
        //      match instance
        let match: RegExpExecArray | null;
        while ((match = regEx.exec(text)) && matchIndex < this.lastJumpInstance) {
            const matchReal: RegExpExecArray = match;

            // Skip if the match also matches an excluded word
            if (excludedRegeces.find(re => re.test(matchReal[0]))) {
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

            startPos = activeEditor.document.positionAt(start);
            endPos = activeEditor.document.positionAt(end);
            matchIndex++;
        }

        // CASE: no matches
        if (matchIndex === 0) {
            // If no matches were found, just exit
            return;
        }

        // CASE: not enough matches yet
        if (matchIndex !== this.lastJumpInstance) {
            // When we did not reach the targeted jump instance, start over from the beginning of the text
            regEx.lastIndex = 0;
            continue;
        }

        // CASE: enough matches were found
        break;
    }

    if (startPos && endPos) {
        // Set the selection to the start/end position found above
        activeEditor.selection = new vscode.Selection(startPos, endPos);
        activeEditor.revealRange(new vscode.Range(startPos, endPos));
        vscode.window.showTextDocument(activeEditor.document, {
            preview: false
        });
    }
}