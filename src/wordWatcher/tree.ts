import * as vscode from 'vscode';
import * as extension from './../extension';
import { WordEntry, WordWatcher } from './wordWatcher';
import { __ } from '../miscTools/help';


// Tree items
//#region tree provider
export async function getChildren (this: WordWatcher, element?: WordEntry): Promise<WordEntry[]> {
    if (!element) {
        // If there is no element, assume that vscode is requesting the root element
        // Word watcher has two root elements, the """search""" bar and the words container
        return [
            {
                type: 'wordSearch',
                id: "wordSearch"
            },
            ...(this.tree!),
        ];
    }
    // Both the search bar and watched words do not have children
    if (element.type === 'wordSearch' || element.type === 'excludedWord') {
        return [];
    }
    else if (element.type === 'watchedWord') {
        return element.exclusions;
    }
    throw new Error('Not implemented WordWatcher.getChildren()');
}

export function getTreeItem (this: WordWatcher, element: WordEntry): vscode.TreeItem {
    if (element.type === 'wordSearch') {
        return {
            id: element.type,
            label: "Watch out for a new word",
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            resourceUri: vscode.Uri.file(element.id),
            command: { 
                title: "Search",
                command: 'wt.wordWatcher.newWatchedWord', 
                arguments: [],
            },
            tooltip: "Watch out for a new word",
            contextValue: 'wordSearch',
            iconPath: new vscode.ThemeIcon('search')
        } as vscode.TreeItem;
    }
    else if (element.type === 'watchedWord') {

        // Context value is different, depending on whether this watched word is disabled or not
        const isDisabled = this.disabledWatchedWords.find(disabled => disabled === element.word);
        let contextValue: string;
        let color: vscode.ThemeColor | undefined;
        let icon: string;
        if (isDisabled) {
            contextValue = 'watchedWord_disabled';
            color = undefined;
            icon = 'circle-large-outline'
        }
        else {
            contextValue = 'watchedWord_enabled';
            color = new vscode.ThemeColor('debugConsole.warningForeground');
            icon = 'pass-filled';
        }

        return {
            id: element.id,
            label: element.word,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            resourceUri: vscode.Uri.file(element.id),
            command: { 
                command: 'wt.wordWatcher.toggleWatchedWord', 
                title: "Toggle Word Enablement", 
                arguments: [ element.word ],
            },
            contextValue: contextValue,
            tooltip: element.word,
            iconPath: new vscode.ThemeIcon(icon, color)
        } as vscode.TreeItem;
    }
    else if (element.type === 'excludedWord') {
        return {
            id: element.id,
            label: element.exclusion,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            resourceUri: vscode.Uri.file(element.id),
            contextValue: 'excludedWord',
            tooltip: element.exclusion,
            iconPath: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.green.'))
        } as vscode.TreeItem;
    }
    throw new Error('Not possible');
}

export async function getParent (this: WordWatcher, element: WordEntry): Promise<WordEntry | null> {
    if (!this.tree) throw 'Unreachable';
    switch (element.type) {
        case 'wordSearch': return null;
        case 'watchedWord': 
            return this.tree.find(watchedEntry => {
                return watchedEntry.id === element.id;
            }) || null;
        case 'excludedWord': 
            return this.tree.find(watchedEntry => {
                return watchedEntry.exclusions.find(excludedEntry => {
                    return excludedEntry.id === element.id;
                });
            }) || null;
    }
}

