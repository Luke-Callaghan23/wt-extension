import * as vscode from 'vscode';
import * as extension from './extension';
import { lastCommit as _lastCommit } from './gitTransactions';
import { Packageable } from './packageable';
import { FileAccessManager } from './fileAccesses';
import { DiskContextType, loadWorkspaceContext } from './workspace/workspace';

type TabPositions = { 
    [index: string]: {
        [index: string]: {
            anchorLine: number,
            anchorChar: number,
            activeLine: number,
            activeChar: number,
            active: boolean,
        }
    } 
};

export class ReloadWatcher implements Packageable {
    constructor (
        private context: vscode.ExtensionContext
    ) {
        const contextValuesUri = vscode.Uri.joinPath(extension.rootPath, "data", "contextValues.json");
        const watcher = vscode.workspace.createFileSystemWatcher(contextValuesUri.fsPath);
        watcher.onDidChange((uri) => this.changedContextValues(uri));
        watcher.onDidDelete((uri) => this.changedContextValues(uri));
        watcher.onDidCreate((uri) => this.changedContextValues(uri));
    }

    async changedContextValues (uri: vscode.Uri) {
        const time = Date.now();
        const lastCommit = _lastCommit;
        if (time - lastCommit <= 1000) {
            // If the last commit was less than a second ago, then this is a false alarm
            return;
        }

        const response = await vscode.window.showInformationMessage("Reload", {
            modal: true,
            detail: "We detected a change in your WTANIWE environment not done by WTANIWE itself, would you like to reload the extension?  (This will update all views to reflect any changes made outside of WTANIWE).\nIn the case of a git pull or branch change, we can also close all current tabs and open the tabs from the branch or remote origin you pulled from.",
        }, "Reload view and tabs", "Don't reload tabs", "Don't reload");
        if (!response || response === "Don't reload") return;

        if (response === "Reload view and tabs") {

        }
        
        const contextValues: DiskContextType = await loadWorkspaceContext(this.context, uri);
        return Promise.all([
            vscode.commands.executeCommand("wt.outline.refresh", contextValues['wt.outline.collapseState']),
            vscode.commands.executeCommand("wt.recyclingBin.refresh"),
            vscode.commands.executeCommand("wt.import.fileExplorer.refresh"),
            vscode.commands.executeCommand("wt.todo.refresh", contextValues['wt.todo.collapseState']),
            vscode.commands.executeCommand("wt.wordWatcher.refresh", {
                watchedWords: contextValues['wt.wordWatcher.watchedWords'],
                disabledWatchedWords: contextValues['wt.wordWatcher.disabledWatchedWords'],
                unwatchedWords: contextValues['wt.wordWatcher.unwatchedWords'],
                rgbaColors: contextValues['wt.wordWatcher.rgbaColors'],
            }),
            vscode.commands.executeCommand("wt.synonyms.refresh", contextValues['wt.synonyms.synonyms']),
            vscode.commands.executeCommand("wt.wh.refresh", contextValues['wt.wh.synonyms']),
            vscode.commands.executeCommand("wt.personalDictionary.refresh", contextValues['wt.personalDictionary']),
            vscode.commands.executeCommand("wt.colors.refresh", contextValues['wt.colors.extraColors']),
            vscode.commands.executeCommand("wt.workBible.refresh"),
        ]).then(() => {
            vscode.commands.executeCommand('wt.timedViews.update');
        });


        // TODO
        // Add word watcher refresh    -- add to package json
        // Add work bible refresh      -- add to package json
        // Add synonym refresh         -- add to package json
        // Add wh refresh              -- add to package json
        // Add spellcheck refresh      -- add to package json
        // Add colors refresh          -- add to package json

    }

    

    getPackageItems(): { [index: string]: any; } {
        
        const tabPackage: TabPositions = {};


        try {
            for (const tg of vscode.window.tabGroups.all) {
                const viewColumn = tg.viewColumn + "";
                tabPackage[viewColumn] = {};
                for (const tab of tg.tabs) {
                    if (!tab.input || Object.keys(tab.input).includes("uri")) {
                        continue;
                    }

                    const uri = (tab.input as vscode.TabInputText).uri;
                    const usableUri = uri.fsPath.replace(extension.rootPath.fsPath, '');
                    
                    const selection = FileAccessManager.getPosition(uri);
                    
                    let anchorLine: number = 0;
                    let anchorChar: number = 0;
                    let activeLine: number = 0;
                    let activeChar: number = 0;

                    if (selection) {
                        const anchor = selection.anchor;
                        anchorLine = anchor.line;
                        anchorChar = anchor.character;
            
                        const active = selection.active;
                        activeLine = active.line;
                        activeChar = active.character;
                    }
        
                    tabPackage[viewColumn][usableUri] = {
                        anchorLine, anchorChar,
                        activeLine, activeChar,
                        active: tab.isActive,
                    };
                }
            }
        }
        catch (e) {
            console.log(`${e}`);
        }
        return {
            "wt.reloadWatcher.tabs": tabPackage
        };
    }
}