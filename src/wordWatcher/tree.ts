import * as vscode from 'vscode';
import * as extension from './../extension';
import { WordEnrty, WordWatcher } from './wordWatcher';


// Tree items
//#region tree provider
export async function getChildren (this: WordWatcher, element?: WordEnrty): Promise<WordEnrty[]> {
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

export function getTreeItem (this: WordWatcher, element: WordEnrty): vscode.TreeItem {
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