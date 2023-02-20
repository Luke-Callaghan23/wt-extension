/* eslint-disable curly */
import * as vscode from 'vscode';
import { Workspace } from './../../../workspace/workspace';
import * as console from './../../../vsconsole';

export interface WordEnrty {
	uri: string;
	type: 'wordSearch' | 'wordContainer' | 'word';
}

export class WordWatcher implements vscode.TreeDataProvider<WordEnrty> {
    
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
                }
            ];
        }
        // Both the search bar and watched words do not have children
        if (element.type === 'wordSearch' || element.type === 'word') {
            return [];
        }

        // The word container has entries for each word in this.words
        return this.words.map(word => ({
            type: 'word',
            uri: word
        }));
	}

	getTreeItem (element: WordEnrty): vscode.TreeItem {
        if (element.type === 'wordSearch') {
            return {
                id: element.type,
                label: "Watch out for a new word",
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                resourceUri: vscode.Uri.parse(element.uri),
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
                resourceUri: vscode.Uri.parse(element.type),
                contextValue: 'wordContainer'
            } as vscode.TreeItem;
        }
        else if (element.type === 'word') {
            return {
                id: element.uri,
                label: element.uri,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                resourceUri: vscode.Uri.parse(element.uri),
                command: { 
                    command: 'wt.wordWatcher.jumpNextInstanceOf', 
                    title: "Search", 
                    arguments: [ element.uri ],
                },
                contextValue: 'word',
                iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('debugConsole.warningForeground'))
            } as vscode.TreeItem;
        }
        throw new Error('Not possible');
	}

    private words: string[];
    private async wordSearch () {
        while (true) {
            const response = await vscode.window.showInputBox({
                placeHolder: 'very',
                ignoreFocusOut: false,
                prompt: 'Enter the word or word pattern that you would like to watch out for (note: only alphabetical characters are allowed inside of watched words)',
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

            // Check if the word is already in the word list
            if (this.words.find(existing => existing === response)) {
                const proceed = await vscode.window.showInformationMessage(`Word '${response}' already in list of watched words!`, {
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
            this.addWord(response);
            this.triggerUpdateDecorations(true);
            this.refresh();
            return;
        }
    }

    private lastJumpWord: string | undefined;
    private lastJumpInstance: number;
    private async jumpNextInstanceOf (word: string) {
        if (!this.activeEditor) return;
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
		const regEx = new RegExp(word, 'g');
        
		const text = this.activeEditor.document.getText();
		
        let startPos, endPos;
        let matchIndex = 0;
        while (true) {
            // Match the text for the selected word, as long as the match index is less than the targeted 
            //      match instance
            let match;
            while ((match = regEx.exec(text)) && matchIndex < this.lastJumpInstance) {
                startPos = this.activeEditor.document.positionAt(match.index);
                endPos = this.activeEditor.document.positionAt(match.index + match[0].length);
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
            this.activeEditor.selection = new vscode.Selection(startPos, endPos);
            this.activeEditor.revealRange(new vscode.Range(startPos, endPos));
            vscode.window.showTextDocument(this.activeEditor.document);
        }

    }

    // Decoration for watched words
    private static watchedWordDecoration = vscode.window.createTextEditorDecorationType({
		borderWidth: '1px',
        borderRadius: '3px',
		borderStyle: 'solid',
		overviewRulerColor: 'blue',
        backgroundColor: 'darkred',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		light: {
			// this color will be used in light color themes
			borderColor: 'darkblue'
		},
		dark: {
			// this color will be used in dark color themes
			borderColor: 'darkred'
		}
	});

    // Updates the decorations for watched words -- colors them in a little red box
    private activeEditor: vscode.TextEditor | undefined;
    private updateDecorations () {
		if (!vscode.window.activeTextEditor) {
			return;
		}

        const activeEditor = vscode.window.activeTextEditor;
        
        // Create a single regex for all words in this.words
		const regex = new RegExp(this.words.join('|'), 'g');
        
		const text = activeEditor.document.getText();
		
        // While there are more matches within the text of the document, collect the match selection
        const matched: vscode.DecorationOptions[] = [];
        let match;
		while ((match = regex.exec(text))) {
			const startPos = activeEditor.document.positionAt(match.index);
			const endPos = activeEditor.document.positionAt(match.index + match[0].length);
			const decoration = { 
                range: new vscode.Range(startPos, endPos), 
                hoverMessage: '**' + match[0] + '**' 
            };
            matched.push(decoration);
		}
		activeEditor.setDecorations(WordWatcher.watchedWordDecoration, matched);
	}

    private timeout: NodeJS.Timer | undefined = undefined;
	private triggerUpdateDecorations(throttle = false) {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = undefined;
		}
		if (throttle) {
			this.timeout = setTimeout(() => this.updateDecorations(), 500);
		} else {
			this.updateDecorations();
		}
	}
    
    registerCommands () {
        vscode.commands.registerCommand('wt.wordWatcher.wordSearch', () => this.wordSearch());
        vscode.commands.registerCommand('wt.wordWatcher.jumpNextInstanceOf', (word: string) => {
            this.jumpNextInstanceOf(word);
        });
        vscode.commands.registerCommand('wt.wordWatcher.help', () => {
            vscode.window.showInformationMessage(`The Word Watcher`, {
                modal: true,
                detail: `The Word Watcher panel is an area where you can add and track certain 'problem' words you may want to watch out for in your work.  Any words added in this area will be highlighted inside of the vscode editor, so you can notice them more easily while writing.  You can also use patterns with a simplified subset of regexes including only: groups '()', sets '[]', one or more '+', zero or more '*', optional '?', and alphabetic characters a-z, A-Z`
            }, 'Okay');
        });

        vscode.commands.registerCommand('wt.wordWatcher.delete', (resource: WordEnrty) => {
            const resourceIndex = this.words.findIndex(word => word === resource.uri);
            if (resourceIndex === -1) {
                vscode.window.showErrorMessage(`ERROR: could not find word with uri: '${resource.uri}'`);
                return;
            }
            this.removeWord(resourceIndex);
            this.triggerUpdateDecorations(true);
            this.refresh();
        });
	}

    // Refresh the word tree
    private _onDidChangeTreeData: vscode.EventEmitter<WordEnrty | undefined> = new vscode.EventEmitter<WordEnrty | undefined>();
	readonly onDidChangeTreeData: vscode.Event<WordEnrty | undefined> = this._onDidChangeTreeData.event;
    refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

    private addWord (word: string) {
        this.words.push(word);
        this.context.workspaceState.update('watchedWords', this.words);
    }

    private removeWord (index: number) {
        this.words.splice(index, 1);
        this.context.workspaceState.update('watchedWords', this.words);
    }


	constructor(
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
        const words: string[] | undefined = context.workspaceState.get('watchedWords');
        this.lastJumpWord = undefined;
        this.lastJumpInstance = 0;

        // Initial words are 'very' and 'any
        this.words = words ?? [ 'very', '[a-zA-Z]+ly' ];

		context.subscriptions.push(vscode.window.createTreeView('wt.wordWatcher', { treeDataProvider: this }));
        this.registerCommands();
		
        // If there is an active editor, then trigger decarator updates off the bat
        this.activeEditor = vscode.window.activeTextEditor;
        if (this.activeEditor) {
            this.triggerUpdateDecorations();
        }
    
        // If the active editor changed, then change the internal activeEditor value and trigger decarator updates
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.activeEditor = editor;
            if (editor) {
                this.triggerUpdateDecorations();
            }
        }, null, context.subscriptions);
    
        // On text document change within the editor, update decorations with throttle
        vscode.workspace.onDidChangeTextDocument(event => {
            if (this.activeEditor && event.document === this.activeEditor.document) {
                this.triggerUpdateDecorations(true);
            }
        }, null, context.subscriptions);
	}
}