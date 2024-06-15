import * as vscode from 'vscode';
import * as extension from './extension';
import { lastCommit as _lastCommit } from './gitTransactions';
import { Packageable } from './packageable';
import { FileAccessManager } from './fileAccesses';
import { DiskContextType, loadWorkspaceContext } from './workspace/workspace';

type PositionInfo = {
    anchorLine: number,
    anchorChar: number,
    activeLine: number,
    activeChar: number,
    active: boolean,
};

export type TabPositions = { 
    [index: string]: {
        [index: string]: PositionInfo
    } 
};

export class ReloadWatcher implements Packageable {
    constructor (
        private context: vscode.ExtensionContext
    ) {
        const contextValuesUri = vscode.Uri.joinPath(extension.rootPath, "data", "contextValues.json");
        const watcher = vscode.workspace.createFileSystemWatcher(contextValuesUri.fsPath);
        watcher.onDidChange(() => this.changedContextValues(contextValuesUri, 'change'));
        watcher.onDidDelete(() => this.changedContextValues(contextValuesUri, 'delete'));
        watcher.onDidCreate(() => this.changedContextValues(contextValuesUri, 'create'));
    }

    async changedContextValues (contextValuesUri: vscode.Uri, action: "create" | "delete" | "change") {
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

        // When the action was a delete, write a new empty state context values json file to disk just so the rest of the 
        //      method works
        if (action === 'delete') {
            await vscode.workspace.fs.writeFile(contextValuesUri, extension.encoder.encode(JSON.stringify({
                "wt.colors.enabled": true,
                "wt.colors.extraColors": {},
                "wt.fileAccesses.positions": {},
                "wt.outline.collapseState": {},
                "wt.personalDictionary": {},
                "wt.reloadWatcher.openedTabs": {},
                "wt.spellcheck.enabled": true,
                "wt.synonyms.synonyms": [],
                "wt.textStyle.enabled": true,
                "wt.todo.collapseState": {},
                "wt.todo.enabled": true,
                "wt.very.enabled": true, 
                "wt.wh.synonyms": [],
                "wt.wordWatcher.disabledWatchedWords": [],
                "wt.wordWatcher.enabled": true,
                "wt.wordWatcher.rgbaColors": {},
                "wt.wordWatcher.unwatchedWords": [],
                "wt.wordWatcher.watchedWords": [],
                "wt.workBible.dontAskDeleteAppearance": false,
                "wt.workBible.dontAskDeleteDescription": false,
                "wt.workBible.dontAskDeleteNote": false,
                "wt.workBible.tree.enabled": false,
            })));
        }

        // Load context items from the new context values json 
        const contextValues: DiskContextType = await loadWorkspaceContext(this.context, contextValuesUri);

        if (response === "Reload view and tabs") {
            // Reload tabs

            // First, close all the active tab groups
            await vscode.window.tabGroups.close(vscode.window.tabGroups.all);

            const tabContext = contextValues["wt.reloadWatcher.openedTabs"];
            for (const [ viewColStr, tabs ] of Object.entries(tabContext)) {
                const viewCol = parseInt(viewColStr);
                if (isNaN(viewCol)) continue;

                // Open all of the tabs in this tab group in order
                let activeUri: vscode.Uri | undefined;
                for (const [ relativePath, positions ] of Object.entries(tabs)) {
                    const openUri = vscode.Uri.joinPath(extension.rootPath, relativePath);
                    await vscode.window.showTextDocument(openUri, {
                        viewColumn: viewCol,
                        selection: new vscode.Range(
                            new vscode.Position(positions.activeLine, positions.activeChar),
                            new vscode.Position(positions.anchorLine, positions.activeChar)
                        ),
                        preview: false,
                    });

                    // Save the active tab for later
                    if (!activeUri && positions.active) {
                        activeUri = openUri;
                    }
                }

                // If we came across the active tab, then re-show that document
                if (activeUri) {
                    await vscode.window.showTextDocument(activeUri, {
                        viewColumn: viewCol,
                        // Since we opened it with the correct positions earlier, we don't need to do it again here
                        preview: false,
                    });
                }
            }
        }
        
        // Either of the first two options requires us to update the internals of all views and timed classes
        //      as well as other internal information

        // Using those context values reload all views and timed classes
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
            // And trigger a forced timed views update
            vscode.commands.executeCommand('wt.timedViews.update');
        });
        
    }

    

    getPackageItems(): { [index: string]: any; } {
        const tabPackage: TabPositions = {};
        try {
            for (const tg of vscode.window.tabGroups.all) {
                const viewColumn = tg.viewColumn + "";
                tabPackage[viewColumn] = {};
                for (const tab of tg.tabs) {
                    if (!tab.input || !Object.keys(tab.input).includes("uri")) {
                        continue;
                    }

                    const uri = (tab.input as vscode.TabInputText).uri;
                    const usableUri = uri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
                    
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
            "wt.reloadWatcher.openedTabs": tabPackage
        };
    }
}