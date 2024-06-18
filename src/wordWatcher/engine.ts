import * as vscode from 'vscode';
import * as extension from './../extension';
import { WordWatcher } from './wordWatcher';
import { TimedView } from '../timedView';
import { Workspace } from '../workspace/workspaceClass';
import { setLastCommit } from '../gitTransactions';

export function addOrDeleteTargetedWord (
    this: WordWatcher,
    operation: 'add' | 'delete' | 'replace',
    target: string,
    contextItem: 'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.unwatchedWords' | 'wt.wordWatcher.disabledWatchedWords',
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
    else if (contextItem === 'wt.wordWatcher.unwatchedWords') {
        targetArray = this.unwatchedWords;
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
        targetArray[replaceIndex] = target;
    }
    else {
        throw new Error(`Not possible -- operation '${operation}' is invalid`);
    }
    
    // Do updates 
    this.wasUpdated = true;
    this.context.workspaceState.update(contextItem, targetArray);
    Workspace.packageContextItems(true);
    for (const editor of vscode.window.visibleTextEditors) {
        this.update(editor, TimedView.findCommentedRanges(editor));
    }

    if (!preventRefresh) {
        this.refresh();
    }
}

export async function addWordToWatchedWords (this: WordWatcher, options?: {
    watched?: boolean,          // default true
    addWord?: boolean           // default true
    placeholder?: string,       // default 'very'
    value?: string,             // default undefined
}): Promise<string | null> {
    options = options || {};
    if (options.watched === undefined) {
        options.watched = true;
    }
    if (options.addWord === undefined) {
        options.addWord = true;
    }
    if (options.placeholder === undefined) {
        options.placeholder = 'very';
    }

    const watchedWord = options.watched;
    const not = !watchedWord ? 'not' : '';
    const un = !watchedWord ? 'un-' : '';
    while (true) {
        const response = await vscode.window.showInputBox({
            placeHolder: options.placeholder,
            value: options.value,
            ignoreFocusOut: false,
            prompt: `Enter the word or word pattern that you would like to ${not} watch out for (note: only alphabetical characters are allowed inside of watched words)`,
            title: 'Add word'
        });
        if (!response) return null;

        // Regex for filtering out responses that do not follow the regex subset for specifying watched words
        // Subset onyl includes: groupings '()', sets '[]', one or more '+', zero or more '*', and alphabetical characters
        const allowCharacters = /^[a-zA-Z\(\)\[\]\*\+\?-\s|]+$/;
        // Regex for matching any escaped non-alphabetical character
        const escapedNonAlphabetics = /\\\(|\\\[|\\\]|\\\)|\\\*|\\\+|\\\?|\\\-/;

        // Test to make sure there aren't any invalid characters in the user's response or if there are any escaped characters that
        //      should not be escaped
        if (!allowCharacters.test(response) || escapedNonAlphabetics.test(response)) {
            const proceed = await vscode.window.showInformationMessage(`Could not parse specified word/pattern!`, {
                modal: true,
                detail: "List of allowed characters in watched word/pattern is: a-z, A-Z, '*', '+', '?', '(', ')', '[', ']', and '-', where all non alphabetic characters must not be escaped."
            }, 'Okay', 'Cancel');
            if (proceed === 'Cancel') return null;
            continue;
        }

        const targetWords = watchedWord
            ? this.watchedWords
            : this.unwatchedWords;

        // Check if the word is already in the word list
        if (targetWords.find(existing => existing === response)) {
            const proceed = await vscode.window.showInformationMessage(`Word '${response}' already in list of ${un}watched words!`, {
                modal: true
            }, 'Okay', 'Cancel');
            if (proceed === 'Cancel') return null;
            continue;
        }

        // Attempt to creat a regex from the response, if the creation of a regexp out of the word caused an exception, report that to the user
        try {
            new RegExp(response);
        }
        catch (e) {
            const proceed = await vscode.window.showInformationMessage(`An error occurred while creating a Regular Expression from your response!`, {
                modal: true,
                detail: `Error: ${e}`
            }, 'Okay', 'Cancel');
            if (proceed === 'Cancel') return null;
            continue;
        }

        if (options.addWord) {
            setLastCommit();
            // If the word is valid and doesn't already exist in the word list, then continue adding the words
            this.updateWords('add', response, watchedWord ? 'wt.wordWatcher.watchedWords' : 'wt.wordWatcher.unwatchedWords');
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
    //      they were calculated, then use the unwatchedRegeces RegExp array from there
    let unwatchedRegeces: RegExp[];
    if (!(this.wasUpdated || !this.lastCalculatedRegeces)) {
        unwatchedRegeces = this.lastCalculatedRegeces.unwatchedRegeces;
    }
    else {
        // Otherwise, calculate the array of unwatched regeces
        unwatchedRegeces = this.unwatchedWords.map(unwatched => new RegExp(`${extension.wordSeparator}${unwatched}${extension.wordSeparator}`, 'gi'));
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
        vscode.window.showTextDocument(activeEditor.document);
    }
}