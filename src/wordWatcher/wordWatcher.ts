/* eslint-disable curly */
import * as vscode from 'vscode';
import { DiskContextType, Workspace } from '../workspace/workspaceClass';
import * as console from '../miscTools/vsconsole';
import { Packageable, Packager } from '../packageable';
import { Timed } from '../timedView';
import * as extension from '../extension';
import { update, disable, defaultWatchedWordDecoration as defaultDecoration, changeColor, changePattern, ColorEntry, createDecorationType, convertWordColorsToContextItem, createDecorationFromRgbString, defaultWatchedWordDecoration } from './timer';
import { getChildren, getTreeItem } from './tree';
import { addWordToWatchedWords, addOrDeleteTargetedWord, jumpNextInstanceOfWord } from './engine';
import { hexToRgb } from '../miscTools/help';
import { gatherPaths, commonWordsPrompt } from './commonWords';
import { colorPick } from './colorPick';

export interface WordEnrty {
	uri: string;
	type: 'wordSearch' | 'wordContainer' | 'unwatchedWordContainer' | 'watchedWord' | 'unwatchedWord';
}

export class WordWatcher implements vscode.TreeDataProvider<WordEnrty>, Packageable<'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.disabledWatchedWords' | 'wt.wordWatcher.unwatchedWords' | 'wt.wordWatcher.rgbaColors'>, Timed {
    
    
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

    private view: vscode.TreeView<WordEnrty>;

    
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
    colorPick = colorPick;
    
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

        this.view = vscode.window.createTreeView('wt.wordWatcher', { treeDataProvider: this });
		context.subscriptions.push(this.view);
        context.subscriptions.push(defaultWatchedWordDecoration);
        this.registerCommands();
	}

    getUpdatesAreVisible(): boolean {
        // Even though this is a distinct view panel view, and most other view panels do not get updated when
        //      they are not visible, the word watcher is intended to still highlight when the panel is not visible
        return true;
    }

    registerCommands () {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.newWatchedWord', () => this.addWord({ watched: true })));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.newUnwatchedWord', () => this.addWord({
            watched: false,
        })));
        
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.jumpNextInstanceOf', (word: string) => {
            this.jumpNextInstanceOf(word);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.help', () => {
            vscode.window.showInformationMessage(`The Word Watcher`, {
                modal: true,
                detail: `The Word Watcher panel is an area where you can add and track certain 'problem' words you may want to watch out for in your work.  Any words added in this area will be highlighted inside of the vscode editor, so you can notice them more easily while writing.  You can also use patterns with a simplified subset of regexes including only: groups '()', sets '[]', one or more '+', zero or more '*', optional '?', and alphabetic characters a-z, A-Z`
            }, 'Okay');
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.deleteWord', (resource: WordEnrty) => {
            this.updateWords('delete', resource.uri, 'wt.wordWatcher.watchedWords');
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.deleteUnwatchedWord', (resource: WordEnrty) => {
            this.updateWords('delete', resource.uri, 'wt.wordWatcher.unwatchedWords');
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.disableWatchedWord', (resource: WordEnrty) => {
            this.updateWords('add', resource.uri, 'wt.wordWatcher.disabledWatchedWords');
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.enableWatchedWord', (resource: WordEnrty) => {
            this.updateWords('delete', resource.uri, 'wt.wordWatcher.disabledWatchedWords')
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.toggleWatchedWord', (word: string) => {
            const operation = this.disabledWatchedWords.includes(word)
                ? 'delete'
                : 'add';
            this.updateWords(operation, word, 'wt.wordWatcher.disabledWatchedWords')
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.changeColor', (resource: WordEnrty) => {
            this.changeColor(resource);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.changePattern', (resource: WordEnrty) => {
            this.changePattern(resource);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.addCommonWords', () => {
            return this.commonWordsPrompt();
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.refresh", (refreshWith: {
            watchedWords: string[],
            disabledWatchedWords: string[],
            unwatchedWords: string[],
            rgbaColors: { [index: string]: string },
        }) => {

            this.watchedWords = refreshWith.watchedWords;
            this.disabledWatchedWords = refreshWith.disabledWatchedWords;
            this.unwatchedWords = refreshWith.unwatchedWords;

            const contextColors = refreshWith.rgbaColors;
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
            
            this.refresh();
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.colorPicker.pick", async () => {
            // this.colorPick('maybe|perhaps', 'maybe')
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.commandPalette.changeColor", async () => {
            const change = await this.selectWatchedWord();
            if (!change) return null;
            return this.changeColor({
                type: 'watchedWord',
                uri: change
            });
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.commandPalette.changePattern", async () => {
            const change = await this.selectWatchedWord();
            if (!change) return null;
            return this.changePattern({
                type: 'watchedWord',
                uri: change
            });
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.commandPalette.deleteWord", async () => {
            const del = await this.selectWatchedWord();
            if (!del) return null;
            return this.updateWords('delete', del, 'wt.wordWatcher.watchedWords');
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.commandPalette.deleteUnwatchedWord", async () => {
            const del = await this.selectUnwatchedWord();
            if (!del) return null;
            return this.updateWords('delete', del, 'wt.wordWatcher.unwatchedWords');
        }));

	}

    private async selectWatchedWord (): Promise<string | null> {
        
        interface WordEntryItem extends vscode.QuickPickItem {
            label: string;
            word: string;
        }
        const wei: WordEntryItem[] = this.watchedWords.map(word => ({
            label: `$(edit) ${word}`,
            word: word,
        }));

        const word = await vscode.window.showQuickPick(wei, {
            canPickMany: false,
            ignoreFocusOut: false,
            title: "Select a watched word"
        });
        if (!word) return null;
        return word.word;
    }

    private async selectUnwatchedWord () {
        interface WordEntryItem extends vscode.QuickPickItem {
            label: string;
            word: string;
        }
        const wei: WordEntryItem[] = this.unwatchedWords.map(word => ({
            label: `$(edit) ${word}`,
            word: word,
        }));

        const word = await vscode.window.showQuickPick(wei, {
            canPickMany: false,
            ignoreFocusOut: false,
            title: "Select an unwatched word"
        });
        if (!word) return null;
        return word.word;
    }

    getPackageItems(packager: Packager<'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.disabledWatchedWords' | 'wt.wordWatcher.unwatchedWords' | 'wt.wordWatcher.rgbaColors'>): Pick<DiskContextType, 'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.disabledWatchedWords' | 'wt.wordWatcher.unwatchedWords' | 'wt.wordWatcher.rgbaColors'> {
        return packager({
            'wt.wordWatcher.watchedWords': this.watchedWords,
            'wt.wordWatcher.disabledWatchedWords': this.disabledWatchedWords,
            'wt.wordWatcher.unwatchedWords': this.unwatchedWords,
            'wt.wordWatcher.rgbaColors': convertWordColorsToContextItem(this.wordColors)
        })
    }
}