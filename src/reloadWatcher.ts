import * as vscode from 'vscode';
import * as extension from './extension';
import { lastCommit as _lastCommit, setLastCommit } from './gitTransactions';
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
    private lastReload: number;
    constructor (
        private context: vscode.ExtensionContext
    ) {
        this.lastReload = 0;
        const contextValuesUri = vscode.Uri.joinPath(extension.rootPath, "data", "contextValues.json");
        const watcher = vscode.workspace.createFileSystemWatcher(contextValuesUri.fsPath);
        watcher.onDidChange(() => {
            this.changedContextValues(contextValuesUri);
        });
    }


    async changedContextValues (
        contextValuesUri: vscode.Uri, 
    ) {
        const time = Date.now();
        const lastCommit = _lastCommit;
        if (time - lastCommit <= 1000) {
            // If the last commit was less than a second ago, then this is a false alarm
            return;
        }
        setLastCommit();

        const response = await vscode.window.showInformationMessage("Reload", {
            modal: true,
            detail: "We detected a change in your WTANIWE environment not done by WTANIWE itself, would you like to reload the extension?  (This will update all views to reflect any changes made outside of WTANIWE).\nIn the case of a git pull or branch change, we can also close all current tabs and open the tabs from the branch or remote origin you pulled from.",
        }, "Reload view and tabs", "Don't reload tabs", "Don't reload");
        if (!response || response === "Don't reload") return;

        // Load context items from the new context values json 
        const contextValues: DiskContextType = await loadWorkspaceContext(this.context, contextValuesUri);

        if (response === "Reload view and tabs") {
            // Reload tabs

            // I don't know........
            // I genuinely don't know.........
            // For some reason if this function is called when there is no
            //      active text editor (I THINK?????????????) then the call to
            //      `showTextDocument` below never returns
            // It doesn't throw an error.  It doesn't print anything.  It just
            //      never returns.  It still opens the tab, but it does not return
            //      from the function call.
            // When you try running `showTextDocument` without the await or
            //      in a `setTimeout`, it will open one, or two, or maybe
            //      even three of the text documents in the set, but it
            //      WILL NOT open all of them, and then execution will halt
            //      after those few are opened
            // Additionally, this seems to crash all other extension capabilities
            //      until you reload the window.  ALL OTHER CAPABILITIES OF THE EXTENSION
            //      UNTIL YOU RELOAD THE WINDOW
            // I don't know.
            // I don't know.
            // I don't know.
            // I don't know.
            // For some completely and utterly unexplainable reason, for some reason
            //      unknown to all earthly beings, for some reason known only to jesus and
            //      satan and buddha, putting all this stuff inside of a non-awaited async IIFIE 
            //      fixes everything (me 🔫 me)
            (async () => {
                try {
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
                catch (err: any) {
                    console.log(err)
                }
            })()
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
            vscode.commands.executeCommand("wt.scratchPad.refresh"),
        ]).then(() => {
            // And trigger a forced timed views update
            vscode.commands.executeCommand('wt.timedViews.update');
        }).catch((err) => {
            console.log(err);
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