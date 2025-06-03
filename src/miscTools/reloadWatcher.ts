import * as vscode from 'vscode';
import * as extension from './../extension';
import { createPackageItems, Packageable, Packager } from './../packageable';
import { FileAccessManager } from './fileAccesses';
import { loadWorkspaceContext, PositionInfo, TabPositions } from './../workspace/workspace';
import { DiskContextType, Workspace } from './../workspace/workspaceClass';
import { TabLabels } from './../tabLabels/tabLabels';
import { TabStates } from './tabStates';

export class ReloadWatcher implements Packageable<"wt.reloadWatcher.openedTabs"> {
    private static watcher: vscode.FileSystemWatcher;
    private static contextValuesUri: vscode.Uri;
    private static context: vscode.ExtensionContext;
    constructor (
        private workspace: Workspace,
        private context: vscode.ExtensionContext
    ) {
        ReloadWatcher.context = context;
        ReloadWatcher.contextValuesUri = workspace.contextValuesFilePath;
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.reloadWatcher.reloadWorkspace", () => {
            return ReloadWatcher.changedContextValues(true);
        }));
        
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.reloadWatcher.reloadViews", () => {
            return ReloadWatcher.changedContextValues(true, true);
        }));
        ReloadWatcher.enableReloadWatch();
    }
    
    public static enableReloadWatch () {
        ReloadWatcher.watcher = vscode.workspace.createFileSystemWatcher(ReloadWatcher.contextValuesUri.fsPath);
        this.context.subscriptions.push(ReloadWatcher.watcher);
        this.context.subscriptions.push(ReloadWatcher.watcher.onDidChange(() => {
            ReloadWatcher.changedContextValues();
        }));
        console.log('enabled reload watching');
    }

    public static disableReloadWatch () {
        try {
            ReloadWatcher.watcher.dispose();
            console.log('disabled reload watching');
        }
        catch (err: any) {}
    }


    static async changedContextValues (
        overrideCommitCheck: boolean = false,
        justViews: boolean = false,
    ) {
        
        let reloadTabs = overrideCommitCheck;
        if (!overrideCommitCheck) {
            const time = Date.now();
            if (Workspace.lastWriteTimestamp !== null && Workspace.lastWriteTimestamp + 500 > time) {
                // If the last save of the context file from this extension is less than 3 seconds ago, ignore this
                return;
            }

            const response = await vscode.window.showInformationMessage("Reload", {
                modal: true,
                detail: "We detected a change in your WTANIWE environment not done by WTANIWE itself, would you like to reload the extension?  (This will update all views to reflect any changes made outside of WTANIWE).\nIn the case of a git pull or branch change, we can also close all current tabs and open the tabs from the branch or remote origin you pulled from.",
            }, "Reload views and tabs", "Don't reload tabs", "Don't reload");
            if (!response || response === "Don't reload") return;
            reloadTabs = response === 'Reload views and tabs';
        }

        // Load context items from the new context values json 
        const contextValues: DiskContextType = await loadWorkspaceContext(ReloadWatcher.context, ReloadWatcher.contextValuesUri);

        if (reloadTabs && !justViews) {
            const tabContext = contextValues["wt.reloadWatcher.openedTabs"];
            TabStates.restoreTabState(tabContext, "Previous Workspace");
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
            vscode.commands.executeCommand("wt.notebook.refresh"),
            vscode.commands.executeCommand("wt.scratchPad.refresh"),
            vscode.commands.executeCommand('wt.tabStates.refresh')
        ]).then(() => {
            // And trigger a forced timed views update
            vscode.commands.executeCommand('wt.timedViews.update');
        }).catch((err) => {
            console.log(err);
        });
        
    }


    private async askForRestoreTabs (tabContext: TabPositions) {
        const resp = await vscode.window.showInformationMessage("Reload Tabs: We've detected that your currently opened tabs are different from the ones you've had opened in the past.  Would you like to close current tabs and open the saved tabs?", "Sure", "Nope");
        if (!resp || resp === 'Nope') return;
        (async () => {
            setTimeout(() => TabStates.restoreTabState(tabContext, "Previous Workspace"), 0);
        })()
    }

    async checkForRestoreTabs () {
        const currentTabState = this.getPackageItems(createPackageItems)['wt.reloadWatcher.openedTabs'];
        const contextTabState: DiskContextType['wt.reloadWatcher.openedTabs'] | undefined = this.context.workspaceState.get('wt.reloadWatcher.openedTabs');
        if (!contextTabState) return;
        

        const currentTabGroupsKeys = Object.keys(currentTabState);
        const contextTabGroupsKeys = Object.keys(contextTabState);
        if (currentTabGroupsKeys.length !== contextTabGroupsKeys.length || !currentTabGroupsKeys.every(curr => contextTabGroupsKeys.includes(curr))) {
            return this.askForRestoreTabs(contextTabState);
        }

        for (const viewCol of currentTabGroupsKeys) {
            const currentGroupTabs: { [index:string]: PositionInfo } = currentTabState[viewCol];
            const contextGroupTabs: { [index:string]: PositionInfo } = contextTabState[viewCol];

            const thisCurrentTabGroupKeys = Object.keys(currentGroupTabs);
            const thisContextTabGroupKeys = Object.keys(contextGroupTabs);

            if (thisCurrentTabGroupKeys.length !== thisContextTabGroupKeys.length || !thisCurrentTabGroupKeys.every(curr => thisContextTabGroupKeys.includes(curr))) {
                return this.askForRestoreTabs(contextTabState);
            }
        }
    }

    getPackageItems(packager: Packager<'wt.reloadWatcher.openedTabs'>): Pick<DiskContextType, 'wt.reloadWatcher.openedTabs'> {
        return packager({
            "wt.reloadWatcher.openedTabs": TabStates.packageCurrentTabState()
        })
    }
}