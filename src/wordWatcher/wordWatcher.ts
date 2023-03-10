/* eslint-disable curly */
import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspace';
import * as console from '../vsconsole';
import { Packageable } from '../packageable';
import { Timed } from '../timedView';
import * as extension from '../extension';

export interface WordEnrty {
	uri: string;
	type: 'wordSearch' | 'wordContainer' | 'unwatchedWordContainer' | 'watchedWord' | 'unwatchedWord';
}

export class WordWatcher implements vscode.TreeDataProvider<WordEnrty>, Packageable, Timed {
    // Words or word patterns that the user wants to watch out for -- will
    //      be highlighted in the editor
    private watchedWords: string[];
    
    // Words in the watchedWords list that are currently disabled
    // They will still show in the watched words list, but they won't be highligted
    //      and jumpNextInstance will skip them
    private disabledWatchedWords: string[];

    // Words that we *don't* want to watch out for, but may be caught by a 
    //      pattern in watchedWords
    private unwatchedWords: string[];
    
    private wasUpdated: boolean = true;
    private lastCalculatedRegeces: {
        watchedAndEnabled: string[],
        regexString: string,
        regex: RegExp,
        unwatchedRegeces: RegExp[],
    } | undefined;


    // Tree items
    //#region tree provider
    async getChildren (element?: WordEnrty): Promise<WordEnrty[]> {
		if (!element) {
            // If there is no element, assume that vscode is requesting the root element
            // Word watcher has two root elements, the """search""" bar and the words container
            return [
                {
                    uri: 'search-bar',
                    type: 'wordSearch'
                },
                {
                    uri: 'word-container',
                    type: 'wordContainer'
                },
                {
                    uri: 'unwatched-container',
                    type: 'unwatchedWordContainer'
                }
            ];
        }
        // Both the search bar and watched words do not have children
        if (element.type === 'wordSearch' || element.type === 'watchedWord' || element.type === 'unwatchedWord') {
            return [];
        }
        // Create word entries for watched words
        else if (element.type === 'wordContainer') {
            return this.watchedWords.map(word => ({
                type: 'watchedWord',
                uri: word
            }));
        }
        else if (element.type === 'unwatchedWordContainer') {
            return this.unwatchedWords.map(word => ({
                type: 'unwatchedWord',
                uri: word
            }));
        }
        throw new Error('Not implemented WordWatcher.getChildren()');
	}

	getTreeItem (element: WordEnrty): vscode.TreeItem {
        if (element.type === 'wordSearch') {
            return {
                id: element.type,
                label: "Watch out for a new word",
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                resourceUri: vscode.Uri.file(element.uri),
                command: { 
                    title: "Search",
                    command: 'wt.wordWatcher.wordSearch', 
                    arguments: [],
                },
                contextValue: 'wordSearch',
                iconPath: new vscode.ThemeIcon('search')
            } as vscode.TreeItem;
        }
        else if (element.type === 'wordContainer') {
            return {
                id: element.type,
                label: "Watched Words",
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                resourceUri: vscode.Uri.file(element.type),
                contextValue: 'wordContainer'
            } as vscode.TreeItem;
        }
        else if (element.type ==='unwatchedWordContainer') {
            return {
                id: element.type,
                label: "Unwatched Words",
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                resourceUri: vscode.Uri.file(element.type),
                contextValue: 'wordContainer'
            }
        }
        else if (element.type === 'watchedWord') {

            // Context value is different, depending on whether this watched word is disabled or not
            const isDisabled = this.disabledWatchedWords.find(disabled => disabled === element.uri);
            let contextValue: string;
            let color: vscode.ThemeColor | undefined;
            if (isDisabled) {
                contextValue = 'watchedWord_disabled';
                color = undefined;
            }
            else {
                contextValue = 'watchedWord_enabled';
                color = new vscode.ThemeColor('debugConsole.warningForeground');
            }

            return {
                id: element.uri,
                label: element.uri,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                resourceUri: vscode.Uri.file(element.uri),
                command: { 
                    command: 'wt.wordWatcher.jumpNextInstanceOf', 
                    title: "Search", 
                    arguments: [ element.uri ],
                },
                contextValue: contextValue,
                iconPath: new vscode.ThemeIcon('warning', color)
            } as vscode.TreeItem;
        }
        else if (element.type === 'unwatchedWord') {
            return {
                id: element.uri,
                label: element.uri,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                resourceUri: vscode.Uri.file(element.uri),
                contextValue: 'unwatchedWord',
                iconPath: new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green.'))
            } as vscode.TreeItem;
        }
        throw new Error('Not possible');
	}
    
    // Refresh the word tree
    private _onDidChangeTreeData: vscode.EventEmitter<WordEnrty | undefined> = new vscode.EventEmitter<WordEnrty | undefined>();
	readonly onDidChangeTreeData: vscode.Event<WordEnrty | undefined> = this._onDidChangeTreeData.event;
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
	}
    //#endregion tree provider

    private updateWords (
        operation: 'add' | 'delete',
        target: string,
        contextItem: 'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.unwatchedWords' | 'wt.wordWatcher.disabledWatchedWords'
    ) {
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
        else {
            throw new Error(`Not possible -- operation '${operation}' is invalid`);
        }
        
        // Do updates 
        this.wasUpdated = true;
        this.context.workspaceState.update(contextItem, targetArray);
        if (vscode.window.activeTextEditor) {
            this.update(vscode.window.activeTextEditor);
        }
        this.refresh();
    }
    
    private async addWord (watchedWord: boolean = true) {
        const not = !watchedWord ? 'not' : '';
        const un = !watchedWord ? 'un-' : '';
        while (true) {
            const response = await vscode.window.showInputBox({
                placeHolder: 'very',
                ignoreFocusOut: false,
                prompt: `Enter the word or word pattern that you would like to ${not} watch out for (note: only alphabetical characters are allowed inside of watched words)`,
                title: 'Add word'
            });
            if (!response) return;

            // Regex for filtering out responses that do not follow the regex subset for specifying watched words
            // Subset onyl includes: groupings '()', sets '[]', one or more '+', zero or more '*', and alphabetical characters
            const allowCharacters = /^[a-zA-Z\(\)\[\]\*\+\?-]+$/;
            // Regex for matching any escaped non-alphabetical character
            const escapedNonAlphabetics = /\\\(|\\\[|\\\]|\\\)|\\\*|\\\+|\\\?|\\\-/;

            // Test to make sure there aren't any invalid characters in the user's response or if there are any escaped characters that
            //      should not be escaped
            if (!allowCharacters.test(response) || escapedNonAlphabetics.test(response)) {
                const proceed = await vscode.window.showInformationMessage(`Could not parse specified word/pattern!`, {
                    modal: true,
                    detail: "List of allowed characters in watched word/pattern is: a-z, A-Z, '*', '+', '?', '(', ')', '[', ']', and '-', where all non alphabetic characters must not be escaped."
                }, 'Okay', 'Cancel');
                if (proceed === 'Cancel') return;
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
                if (proceed === 'Cancel') return;
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
                if (proceed === 'Cancel') return;
                continue;
            }

            // If the word is valid and doesn't already exist in the word list, then continue adding the words
            this.updateWords('add', response, watchedWord ? 'wt.wordWatcher.watchedWords' : 'wt.wordWatcher.unwatchedWords');
            return;
        }
    }

    private lastJumpWord: string | undefined;
    private lastJumpInstance: number;
    private async jumpNextInstanceOf (word: string) {
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
		const regEx = new RegExp(`${extension.wordSeparator}${word}${extension.wordSeparator}`, 'g');

        // If there were no updates to any of the watched/uwatched words since the last time
        //      they were calculated, then use the unwatchedRegeces RegExp array from there
        let unwatchedRegeces: RegExp[];
        if (!(this.wasUpdated || !this.lastCalculatedRegeces)) {
            unwatchedRegeces = this.lastCalculatedRegeces.unwatchedRegeces;
        }
        else {
            // Otherwise, calculate the array of unwatched regeces
            unwatchedRegeces = this.unwatchedWords.map(unwatched => new RegExp(`${extension.wordSeparator}${unwatched}${extension.wordSeparator}`));
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

	constructor(
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
        this.lastJumpWord = undefined;
        this.lastJumpInstance = 0;

        // Read all the words arrays
        const words: string[] | undefined = context.workspaceState.get('wt.wordWatcher.watchedWords');
        const disabledWords: string[] | undefined = context.workspaceState.get('wt.wordWatcher.disabledWatchedWords');
        const unwatched: string[] | undefined = context.workspaceState.get('wt.wordWatcher.unwatchedWords');

        // Initial words are 'very' and 'any
        this.watchedWords = words ?? [ 'very', '[a-zA-Z]+ly' ];
        this.disabledWatchedWords = disabledWords ?? [];
        this.unwatchedWords = unwatched ?? [];

        // Will later be modified by TimedView
        this.enabled = true;

		context.subscriptions.push(vscode.window.createTreeView('wt.wordWatcher', { treeDataProvider: this }));
        this.registerCommands();
	}

    // Decoration for watched words
    private static watchedWordDecoration = vscode.window.createTextEditorDecorationType({
		borderWidth: '1px',
        borderRadius: '3px',
		borderStyle: 'solid',
		overviewRulerColor: 'blue',
        backgroundColor: 'rgb(161, 8, 8, 0.3)',
        borderColor: 'rgb(161, 8, 8, 0.3)',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	});

    enabled: boolean;
    async update(editor: vscode.TextEditor): Promise<void> {
    
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
        editor.setDecorations(WordWatcher.watchedWordDecoration, matched);
    }

    async disable?(): Promise<void> {
        vscode.window.activeTextEditor?.setDecorations(WordWatcher.watchedWordDecoration, []);
    }

    registerCommands () {
        vscode.commands.registerCommand('wt.wordWatcher.newWatchedWord', () => this.addWord(true));
        vscode.commands.registerCommand('wt.wordWatcher.newUnwatchedWord', () => this.addWord(false));
        
        vscode.commands.registerCommand('wt.wordWatcher.jumpNextInstanceOf', (word: string) => {
            this.jumpNextInstanceOf(word);
        });
        vscode.commands.registerCommand('wt.wordWatcher.help', () => {
            vscode.window.showInformationMessage(`The Word Watcher`, {
                modal: true,
                detail: `The Word Watcher panel is an area where you can add and track certain 'problem' words you may want to watch out for in your work.  Any words added in this area will be highlighted inside of the vscode editor, so you can notice them more easily while writing.  You can also use patterns with a simplified subset of regexes including only: groups '()', sets '[]', one or more '+', zero or more '*', optional '?', and alphabetic characters a-z, A-Z`
            }, 'Okay');
        });

        vscode.commands.registerCommand('wt.wordWatcher.deleteWord', (resource: WordEnrty) => {
            this.updateWords('delete', resource.uri, 'wt.wordWatcher.watchedWords');
        });
        vscode.commands.registerCommand('wt.wordWatcher.deleteUnwatchedWord', (resource: WordEnrty) => {
            this.updateWords('delete', resource.uri, 'wt.wordWatcher.unwatchedWords');
        });
        vscode.commands.registerCommand('wt.wordWatcher.disableWatchedWord', (resource: WordEnrty) => {
            this.updateWords('add', resource.uri, 'wt.wordWatcher.disabledWatchedWords');
        });
        vscode.commands.registerCommand('wt.wordWatcher.enableWatchedWord', (resource: WordEnrty) => {
            this.updateWords('delete', resource.uri, 'wt.wordWatcher.disabledWatchedWords')
        });
	}

    getPackageItems(): { [index: string]: any; } {
        return {
            'wt.wordWatcher.watchedWords': this.watchedWords,
            'wt.wordWatcher.disabledWatchedWords': this.disabledWatchedWords,
            'wt.wordWatcher.unwatchedWords': this.unwatchedWords,
        }
    }
}