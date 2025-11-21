/* eslint-disable curly */
import * as vscode from 'vscode';
import { DiskContextType, Workspace } from '../workspace/workspaceClass';
import * as console from '../miscTools/vsconsole';
import { Packageable, Packager } from '../packageable';
import { Timed } from '../timedView';
import * as extension from '../extension';
import { update, disable, defaultWatchedWordDecoration as defaultDecoration, changeColor, changePattern, ColorEntry, createDecorationType, convertWordColorsToContextItem, createDecorationFromRgbString, defaultWatchedWordDecoration } from './timer';
import { getChildren, getTreeItem, getParent } from './tree';
import { addWordToWatchedWords, addOrDeleteTargetedWord, jumpNextInstanceOfWord } from './engine';
import { __, hexToRgb } from '../miscTools/help';
import { gatherPaths, commonWordsPrompt } from './commonWords';
import { colorPick } from './colorPick';
import { v4 as uuid } from 'uuid';

type WordSearchEntry = {
	id: 'wordSearch';
	type: 'wordSearch';
};

type WordWatchedWordEntry = {
    id: string;
    word: string;
    type: 'watchedWord';
    exclusions: WordExcludedWordEntry[];
};

type WordExcludedWordEntry = {
    id: string;
    exclusion: string;
    type: 'excludedWord';
};

export type WordEntry = WordSearchEntry | WordWatchedWordEntry | WordExcludedWordEntry; 

export class WordWatcher implements vscode.TreeDataProvider<WordEntry>, Packageable<'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.disabledWatchedWords' | 'wt.wordWatcher.excludedWords' | 'wt.wordWatcher.rgbaColors'>, Timed {
    
    
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
    public excludedWords: string[];

    public wordColors: { [index: string]: ColorEntry };
    public allDecorationTypes: vscode.TextEditorDecorationType[];

    protected view: vscode.TreeView<WordEntry>;

    protected tree?: WordWatchedWordEntry[];

    // Refresh the word tree
    private _onDidChangeTreeData: vscode.EventEmitter<WordEntry | undefined> = new vscode.EventEmitter<WordEntry | undefined>();
	readonly onDidChangeTreeData: vscode.Event<WordEntry | undefined> = this._onDidChangeTreeData.event;
    
    initializeTree (): WordWatchedWordEntry[] {
        return this.watchedWords.map(watched => {
            return {
                type: "watchedWord",
                id: uuid(),
                word: watched,
                exclusions: this.excludedWords.map(excluded => {
                    if (new RegExp(watched).test(excluded)) {
                        return __<WordExcludedWordEntry>({
                            type: "excludedWord",
                            exclusion: excluded,
                            id: uuid()
                        });
                    }
                    else return [];
                }).flat()
            }
        });
    }
    
    refresh(revealExcluded?: string): void {

        this.tree = this.initializeTree();
        this._onDidChangeTreeData.fire(undefined);

        // If the refresh function was provided an excluded word to reveal
        //      then iterate over every word and its exclusions and reveal
        //      any exclusion whose text matches the provided exclusion
        setTimeout(() => {
            this.tree?.forEach(wordEntry => {
                wordEntry.exclusions.forEach(exclusionEntry => {
                    if (exclusionEntry.exclusion === revealExcluded) {
                        this.view.reveal(exclusionEntry, {
                            expand: true,
                            select: true,
                        });
                    }
                });
            });
        }, 100);
	}

    getChildren = getChildren;
    getTreeItem = getTreeItem;
    getParent = getParent;
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
        excludedRegeces: RegExp[],
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
        const excluded: string[] | undefined = context.workspaceState.get('wt.wordWatcher.excludedWords') 
            // Older versions of contextValues.json might use the previous context value
            || context.workspaceState.get('wt.wordWatcher.unwatchedWords');

        // Initial words are 'very' and 'any
        this.watchedWords = words ?? [ 'very', '[a-zA-Z]+ly' ];
        this.disabledWatchedWords = disabledWords ?? [];
        this.excludedWords = excluded ?? [];
        this.tree = this.initializeTree();

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
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.newExcludedWord', () => this.addWord({
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

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.deleteWord', (resource: WordWatchedWordEntry) => {
            this.updateWords('delete', resource.word, 'wt.wordWatcher.watchedWords');
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.deleteExcludedWord', (resource: WordExcludedWordEntry) => {
            this.updateWords('delete', resource.exclusion, 'wt.wordWatcher.excludedWords');
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.disableWatchedWord', (resource: WordWatchedWordEntry) => {
            this.updateWords('add', resource.word, 'wt.wordWatcher.disabledWatchedWords');
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.enableWatchedWord', (resource: WordWatchedWordEntry) => {
            this.updateWords('delete', resource.word, 'wt.wordWatcher.disabledWatchedWords')
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.toggleWatchedWord', (word: string) => {
            const operation = this.disabledWatchedWords.includes(word)
                ? 'delete'
                : 'add';
            this.updateWords(operation, word, 'wt.wordWatcher.disabledWatchedWords')
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.changeColor', (resource: WordWatchedWordEntry) => {
            this.changeColor(resource.word);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.changePattern', (resource: WordWatchedWordEntry) => {
            this.changePattern(resource.word);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordWatcher.addCommonWords', () => {
            return this.commonWordsPrompt();
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.refresh", (refreshWith: {
            watchedWords: string[],
            disabledWatchedWords: string[],
            excludedWords: string[],
            rgbaColors: { [index: string]: string },
        }) => {

            this.watchedWords = refreshWith.watchedWords;
            this.disabledWatchedWords = refreshWith.disabledWatchedWords;
            this.excludedWords = refreshWith.excludedWords;

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
            return this.changeColor(change);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.commandPalette.changePattern", async () => {
            const change = await this.selectWatchedWord();
            if (!change) return null;
            return this.changePattern(change);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.commandPalette.deleteWord", async () => {
            const del = await this.selectWatchedWord();
            if (!del) return null;
            return this.updateWords('delete', del, 'wt.wordWatcher.watchedWords');
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.wordWatcher.commandPalette.deleteExcludedWord", async () => {
            const del = await this.selectExcludedWord();
            if (!del) return null;
            return this.updateWords('delete', del, 'wt.wordWatcher.excludedWords');
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

    private async selectExcludedWord () {
        interface WordEntryItem extends vscode.QuickPickItem {
            label: string;
            word: string;
        }
        const wei: WordEntryItem[] = this.excludedWords.map(word => ({
            label: `$(edit) ${word}`,
            word: word,
        }));

        const word = await vscode.window.showQuickPick(wei, {
            canPickMany: false,
            ignoreFocusOut: false,
            title: "Select an excluded word"
        });
        if (!word) return null;
        return word.word;
    }

    getPackageItems(packager: Packager<'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.disabledWatchedWords' | 'wt.wordWatcher.excludedWords' | 'wt.wordWatcher.rgbaColors'>): Pick<DiskContextType, 'wt.wordWatcher.watchedWords' | 'wt.wordWatcher.disabledWatchedWords' | 'wt.wordWatcher.excludedWords' | 'wt.wordWatcher.rgbaColors'> {
        return packager({
            'wt.wordWatcher.watchedWords': this.watchedWords,
            'wt.wordWatcher.disabledWatchedWords': this.disabledWatchedWords,
            'wt.wordWatcher.excludedWords': this.excludedWords,
            'wt.wordWatcher.rgbaColors': convertWordColorsToContextItem(this.wordColors)
        })
    }
}