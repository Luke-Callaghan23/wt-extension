import * as vscode from 'vscode';
import * as extension from './../extension';
import { createPackageItems, Packageable, Packager } from './../packageable';
import { FileAccessManager } from './fileAccesses';
import { loadWorkspaceContext, PositionInfo, TabPositions } from './../workspace/workspace';
import { DiskContextType, Workspace } from './../workspace/workspaceClass';
import { TabLabels } from './../tabLabels/tabLabels';
import { TabStates } from './tabStates';
import { Buff } from '../Buffer/bufferSource';

export class ReloadWatcher implements Packageable<"wt.reloadWatcher.openedTabs" | "wt.reloadWatcher.enabled"> {
    private static watcher: vscode.FileSystemWatcher;
    private static contextValuesUri: vscode.Uri;
    private static context: vscode.ExtensionContext;

    private static readonly enabledSettingName = 'wt.reloadWatcher.enabled';
    private static enabled: boolean = true;
    private static updateEnabledStatusFromSettings () {
        const configuration = vscode.workspace.getConfiguration();
        const enabled = configuration.get(ReloadWatcher.enabledSettingName);
        ReloadWatcher.enabled = enabled === undefined ? true : (enabled as boolean);

        if (ReloadWatcher.enabled) {
            ReloadWatcher.enableReloadWatch();
        }
        else {
            ReloadWatcher.disableReloadWatch();
        }
    }

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
        ReloadWatcher.updateEnabledStatusFromSettings();

        // Watch out for changes in the .enabled setting for the reload watcher
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (!e.affectsConfiguration(ReloadWatcher.enabledSettingName)) return;
            ReloadWatcher.updateEnabledStatusFromSettings();
        }));
    }
    
    public static enableReloadWatch () {
        if (!ReloadWatcher.enabled) return;

        // In case there is an existing reload watcher (somehow), dispose of that one before enabling this
        ReloadWatcher.disableReloadWatch();

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
        overrideContextValues: DiskContextType | null = null,
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
        let contextValues: DiskContextType;
        if (!overrideContextValues) {
            contextValues = await loadWorkspaceContext(ReloadWatcher.context, ReloadWatcher.contextValuesUri);
        }
        else {
            contextValues = overrideContextValues;
            await Workspace.replaceContextValuesOnDisk(contextValues);
        }

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
                excludedWords: contextValues['wt.wordWatcher.excludedWords'],
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

        if (contextTabGroupsKeys.length === 0) {
            // If there are 0 tabs in the context file, then don't bother asking to restore
            // Probably means this is their first install.  Don't want to confuse them.
            return;
        }

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

    getPackageItems(packager: Packager<'wt.reloadWatcher.openedTabs' | 'wt.reloadWatcher.enabled'>): Pick<DiskContextType, 'wt.reloadWatcher.openedTabs' | 'wt.reloadWatcher.enabled'> {
        return packager({
            "wt.reloadWatcher.openedTabs": TabStates.packageCurrentTabState(),
            "wt.reloadWatcher.enabled": ReloadWatcher.enabled,
        })
    }
}