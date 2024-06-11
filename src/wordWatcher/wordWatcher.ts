/* eslint-disable curly */
import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../vsconsole';
import { Packageable } from '../packageable';
import { Timed } from '../timedView';
import * as extension from '../extension';
import { update, disable, defaultWatchedWordDecoration as defaultDecoration, changeColor, changePattern, ColorEntry, createDecorationType, convertWordColorsToContextItem, createDecorationFromRgbString } from './timer';
import { getChildren, getTreeItem } from './tree';
import { addWordToWatchedWords, addOrDeleteTargetedWord, jumpNextInstanceOfWord } from './engine';
import { hexToRgb } from '../help';
import { gatherPaths, commonWordsPrompt } from './commonWords';

export interface WordEnrty {
	uri: string;
	type: 'wordSearch' | 'wordContainer' | 'unwatchedWordContainer' | 'watchedWord' | 'unwatchedWord';
}

export class WordWatcher implements vscode.TreeDataProvider<WordEnrty>, Packageable, Timed {
    
    
    enabled: boolean;

    //#endregion tree provider
    // Words or word patterns that the user wants to watch out for -- will
    //      be highlighted in the editor
    public watchedWords: string[];
    
    // Words in the watchedWords list that are currently disabled
    // They will still show in the watched words list, but they won't be highligted
    //      and jumpNextInstance will skip them
    public disabledWatchedWords: string[];

    // Words that we *don't* want to watch out for, but may be caught by a 
    //      pattern in watchedWords
    public unwatchedWords: string[];

    public wordColors: { [index: string]: ColorEntry };


    public allDecorationTypes: vscode.TextEditorDecorationType[];

    
    // Refresh the word tree
    private _onDidChangeTreeData: vscode.EventEmitter<WordEnrty | undefined> = new vscode.EventEmitter<WordEnrty | undefined>();
	readonly onDidChangeTreeData: vscode.Event<WordEnrty | undefined> = this._onDidChangeTreeData.event;
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
	}

    getChildren = getChildren;
    getTreeItem = getTreeItem;
    gatherCommonWords = gatherPaths;
    commonWordsPrompt = commonWordsPrompt;
    
    public lastJumpWord: string | undefined;
    public lastJumpInstance: number;

    updateWords = addOrDeleteTargetedWord;
    addWord = addWordToWatchedWords;
    jumpNextInstanceOf = jumpNextInstanceOfWord;
    
    update = update;
    disable = disable;
    changeColor = changeColor;
    changePattern = changePattern;

    public wasUpdated: boolean = true;
    public lastCalculatedRegeces: {
        watchedAndEnabled: string[],
        regexString: string,
        regex: RegExp,
        unwatchedRegeces: RegExp[],
        watchedRegeces: { uri: string, reg: RegExp }[]
    } | undefined;

	constructor(
        public context: vscode.ExtensionContext,
        public workspace: Workspace,
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

        
        this.allDecorationTypes = [ defaultDecoration ];
        this.wordColors = {};

        // Create decorations for all the unique colors in the workspace state
        const contextColors: { [index: string]: string } = context.workspaceState.get('wt.wordWatcher.rgbaColors') || {};
        this.watchedWords.forEach(watched => {
            const color = contextColors[watched];
            if (!color) return;

            const decoratorType = createDecorationFromRgbString(color);
            this.wordColors[watched] = {
                rgbaString: color,
                decoratorsIndex: this.allDecorationTypes.length
            };

            this.allDecorationTypes.push(decoratorType);
        });

		context.subscriptions.push(vscode.window.createTreeView('wt.wordWatcher', { treeDataProvider: this }));
        this.registerCommands();
	}

    registerCommands () {
        vscode.commands.registerCommand('wt.wordWatcher.newWatchedWord', () => this.addWord({ watched: true }));
        vscode.commands.registerCommand('wt.wordWatcher.newUnwatchedWord', () => this.addWord({
            watched: false,
        }));
        
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
        vscode.commands.registerCommand('wt.wordWatcher.toggleWatchedWord', (word: string) => {
            const operation = this.disabledWatchedWords.includes(word)
                ? 'delete'
                : 'add';
            this.updateWords(operation, word, 'wt.wordWatcher.disabledWatchedWords')
        });
        vscode.commands.registerCommand('wt.wordWatcher.changeColor', (resource: WordEnrty) => {
            this.changeColor(resource);
        });
        vscode.commands.registerCommand('wt.wordWatcher.changePattern', (resource: WordEnrty) => {
            this.changePattern(resource);
        });
	}

    getPackageItems(): { [index: string]: any; } {
        return {
            'wt.wordWatcher.watchedWords': this.watchedWords,
            'wt.wordWatcher.disabledWatchedWords': this.disabledWatchedWords,
            'wt.wordWatcher.unwatchedWords': this.unwatchedWords,
            'wt.wordWatcher.rgbaColors': convertWordColorsToContextItem(this.wordColors)
        }
    }
}