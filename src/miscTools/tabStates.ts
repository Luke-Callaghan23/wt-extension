import * as vscode from 'vscode';
import { DiskContextType, Workspace } from "../workspace/workspaceClass";
import { SavedTabState, TabPositions } from '../workspace/workspace';
import { Packageable } from '../packageable';
import { FileAccessManager } from './fileAccesses';
import * as extension from './../extension';
import { TabLabels } from '../tabLabels/tabLabels';


type StateOption <T> = { label: string, isStateId: true } | { label: T, isStateId: false };

type TabStateCommand = 'wt.tabStates.saveCurrentState' | 'wt.tabStates.overwriteTabState' | 'wt.tabStates.restoreState' | 'wt.tabStates.renameState' | 'wt.tabStates.newEmptyGroup';
export class TabStates implements Packageable {
    private savedTabStates: SavedTabState;
    private statusBar: vscode.StatusBarItem;
    private latestTabState: string | null;

    constructor (private context: vscode.ExtensionContext, private workspace: Workspace) {
        this.savedTabStates = context.workspaceState.get('wt.tabStates.savedTabStates') || {};
        this.latestTabState = context.workspaceState.get("wt.tabStates.latestTabState") || null;
        
        this.statusBar = vscode.window.createStatusBarItem('wt.tabStates.tabStateStatusBarItem', vscode.StatusBarAlignment.Right, 1000000);
        this.statusBar.backgroundColor = new vscode.ThemeColor('terminal.ansiBrightYellow');
        this.statusBar.color = 'white';
        this.statusBar.command = 'wt.tabStates.showStatusBarMenu';
        this.update();

        this.registerCommands();
    }
    
    public static packageCurrentTabState (): TabPositions {
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
        return tabPackage;
    }

    public static async restoreTabState (tabContext: TabPositions, chosenState: string) {
        TabLabels.enabled = false;
        try {
            // First, close all the active tab groups
            await vscode.window.tabGroups.close(vscode.window.tabGroups.all);
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
        TabLabels.enabled = true;
        TabLabels.assignNamesForOpenTabs();
        vscode.window.showInformationMessage(`[Tab States] Restored tab state '${chosenState}'`);
    }

    private async saveCurrentState () {
        const created = Date.now();
        const response = await this.chooseTabState("Chose a group to overwrite, or create a new one", "Create a new tab group");
        if (!response) return;

        let stateId: string;
        if (!response.isStateId && response.label === 'Create a new tab group') {
            const newStateId = await vscode.window.showInputBox({
                ignoreFocusOut: false,
                prompt: `Tab group name`,
                title: `Tab group name`,
            });
            if (!newStateId) return;
            stateId = newStateId;
        }
        else {
            stateId = response.label;
        }

        const currentState: TabPositions = TabStates.packageCurrentTabState();
        this.savedTabStates[stateId] = {
            created: created,
            positions: currentState
        };
        vscode.window.showInformationMessage(`[Tab States] Saved current tab state as '${stateId}'`);
        this.latestTabState = stateId;
    }

    private async chooseTabState <T extends string> (prompt: string, ...extraOptions: T[]): Promise<StateOption<T> | null> {
        const sortedStates = Object.entries(this.savedTabStates).sort(([_a, stateA], [_b, stateB]) => stateB.created - stateA.created);
        
        const stateOptions: StateOption<T>[] = sortedStates.map(([ stateName, _state ]) => ({
            label: stateName,
            isStateId: true
        }));

        for (const extra of extraOptions) {
            stateOptions.push({
                label: extra,
                isStateId: false
            })
        }

        const stateOption = await vscode.window.showQuickPick<StateOption<T>>(stateOptions, {
            canPickMany: false,
            ignoreFocusOut: false,
            matchOnDescription: true,
            matchOnDetail: true,
            title: prompt,
        });
        if (!stateOption) return null;
        return stateOption as StateOption<T>;
    }


    private async renameState (chosenState: string) {
        const newName = await vscode.window.showInputBox({
            placeHolder: chosenState,
            ignoreFocusOut: false,
            prompt: `Assign a new name`,
            title: `Assign a new name`,
            value: chosenState,
            valueSelection: [ 0, chosenState.length ]
        });
        if (!newName) return;
        
        const oldState = this.savedTabStates[chosenState];
        delete this.savedTabStates[chosenState];
        oldState.created = Date.now();
        this.savedTabStates[newName] = oldState;
        vscode.window.showInformationMessage(`[Tab States] Renamed tab state '${chosenState}' to '${newName}'`);
        this.latestTabState = newName;
    }

    private async newEmptyState () {
        const response = await vscode.window.showInformationMessage("Close current tabs?", {
            detail: "Doing this will close all currently opened tabs and start a new tab group.",
            modal: true,
        }, "Yes", "No");
        if (!response || response === 'No') return;

        const newStateId = await vscode.window.showInputBox({
            ignoreFocusOut: false,
            prompt: `New tab group name`,
            title: `New tab group name`,
        });
        if (!newStateId) return;

        // Create an empty tab state
        this.savedTabStates[newStateId] = {
            created: Date.now(),
            positions: {}
        };

        await this.restoreState(newStateId);
        this.latestTabState = newStateId;
    }


    private async overwriteTabState (chosenState: string) {
        const created = Date.now();
        const areYouSure = await vscode.window.showQuickPick([ "Yes", "No" ], {
            canPickMany: false,
            ignoreFocusOut: false,
            matchOnDescription: true,
            matchOnDetail: true,
            title: "Are you sure?",
            placeHolder: "Yes"
        });
        if (!areYouSure || areYouSure !== "Yes") return;

        const currentState: TabPositions = TabStates.packageCurrentTabState();
        this.savedTabStates[chosenState] = {
            created: created,
            positions: currentState,
        };
        vscode.window.showInformationMessage(`[Tab States] Overwrote '${chosenState}' tab state with current state`);
        this.latestTabState = chosenState;
    }


    private async restoreState (chosenState: string) {
        const saveOldState = await vscode.window.showQuickPick([ "Yes", "No" ], {
            canPickMany: false,
            ignoreFocusOut: false,
            matchOnDescription: true,
            matchOnDetail: true,
            title: "Would you like to save the current tab state before switching?",
            placeHolder: "No"
        });
        if (saveOldState === 'Yes') {
            await this.saveCurrentState();
        }
        await TabStates.restoreTabState(this.savedTabStates[chosenState].positions, chosenState);
        this.latestTabState = chosenState;
    }

    private async showStatusBarMenu () {
        type TabStateMenuCommand = vscode.QuickPickItem & ({
            type: 'selectTabState',
            tabStateId: string
        } | {
            type: 'savecurrentTabState',
        } | {
            type: 'createNewEmptyTabState'
        });

        interface TabStateButton extends vscode.QuickInputButton {
            type: 'overwrite' | 'rename' | 'switch',
            tabStateId: string,
            iconPath: vscode.ThemeIcon,
        };

        const iconMap: Record<TabStateButton['type'], vscode.ThemeIcon> = {
            overwrite: new vscode.ThemeIcon('save'),
            rename: new vscode.ThemeIcon('edit'),
            switch: new vscode.ThemeIcon('arrow-swap')
        };

        const descriptionMap: Record<TabStateButton['type'], string> = {
            overwrite: "Overwrite this tab state with the currenly opened tabs",
            rename: "Rename this tab state",
            switch: "Switch to this tab state"
        };

        const buttonIdsArray: TabStateButton['type'][] = [ 'switch', 'overwrite', 'rename' ];

        const currentTabStates: TabStateMenuCommand[] = Object.entries(this.savedTabStates).map(([ stateId, _ ]) => {
            return {
                type: 'selectTabState',
                label: `Select: '${stateId}'`,
                tabStateId: stateId,
                alwaysShow: true,
                buttons: buttonIdsArray.map(operation => ({
                    iconPath: iconMap[operation],
                    tabStateId: stateId,
                    type: operation,
                    tooltip: descriptionMap[operation]
                })),
            };
        })

        const qp = vscode.window.createQuickPick<TabStateMenuCommand>();
        qp.items = [
            ...currentTabStates,
            {
                type: 'savecurrentTabState',
                label: `Save to new state group`,
                alwaysShow: true,
            },
            {
                type: 'createNewEmptyTabState',
                label: "Create new empty state group",
                alwaysShow: true,
            }
        ];
        qp.matchOnDescription = false;
        qp.canSelectMany = false;
        qp.matchOnDetail = false;
        qp.placeholder = '';
        qp.value = '';
        qp.title = 'Select a tab state or create a new one';
        qp.selectedItems = [];
        qp.keepScrollPosition = true;
        qp.ignoreFocusOut = false;
        qp.busy = false;
        qp.enabled = true;
        qp.show();

        return new Promise<void>((accept, reject) => {
            qp.onDidAccept(() => {
                const selected = qp.activeItems[0];
                if (selected.type === 'selectTabState') {
                    type Response = 'Overwrite this tab state' | 'Rename this tab state' | 'Switch to this tab state';
                    vscode.window.showQuickPick([
                        'Switch to this tab state',
                        'Overwrite this tab state',
                        'Rename this tab state',
                    ], {
                        title: "What would you like to do?",
                        canPickMany: false,
                        ignoreFocusOut: false,
                    }).then((resp: string | undefined) => {
                        const response: Response | undefined = resp as Response | undefined;
                        if (!response) {
                            return;
                        }
                        
                        let finishPromise: Promise<void> | undefined;
                        switch (response) {
                            case 'Overwrite this tab state':
                                finishPromise = this.overwriteTabState(selected.tabStateId);
                                break;
                            case 'Rename this tab state': 
                                finishPromise = this.renameState(selected.tabStateId);
                                break;
                            case 'Switch to this tab state':
                                finishPromise = this.restoreState(selected.tabStateId);
                                break;
                        }
                        finishPromise.then(() => this.update());
                    });
                    return;
                }
                else if (selected.type === 'savecurrentTabState') {
                    return this.saveCurrentState().then(() => {
                        this.update();
                        accept()
                    });
                }
                else if (selected.type === 'createNewEmptyTabState') {
                    return this.newEmptyState().then(() => {
                        this.update();
                        accept();
                    });
                }
                ((s: never) => {})(selected);
            });
            qp.onDidTriggerItemButton((event) => {
                const selected = event.button as TabStateButton;
                let finishPromise: Promise<void> | undefined;
                switch (selected.type) {
                    case 'overwrite':
                        finishPromise = this.overwriteTabState(selected.tabStateId);
                        break;
                    case 'rename':
                        finishPromise = this.renameState(selected.tabStateId);
                        break;
                    case 'switch':
                        finishPromise = this.restoreState(selected.tabStateId);
                        break;
                }
                finishPromise!.then(() => {
                    qp.dispose();
                    this.update();
                    accept();
                })
            });
            qp.onDidHide(() => {
                qp.dispose();
                accept();
            })
        })
    }

    private async update () {
        this.context.workspaceState.update('wt.tabStates.savedTabStates', this.savedTabStates);
        this.context.workspaceState.update("wt.tabStates.latestTabState", this.latestTabState);
        const statusBarText = this.latestTabState === null 
            ? 'Tab State Options'
            : `Tab State Options (${this.latestTabState})`
        this.statusBar.text = statusBarText;
        this.statusBar.name = statusBarText;
        this.statusBar.tooltip = statusBarText;
        this.statusBar.show();
    }

    private async runCommand (command: TabStateCommand) {
        if (command === 'wt.tabStates.saveCurrentState') {
            await this.saveCurrentState();
        }
        else if (command === 'wt.tabStates.newEmptyGroup') {
            await this.newEmptyState();
        }
        else {
            const chosenStateOption = await this.chooseTabState("Which tab state?");
            if (!chosenStateOption) return;
            if (!chosenStateOption.isStateId) throw "Unreachable";

            const chosenState = chosenStateOption.label;
            switch (command) {
                case 'wt.tabStates.overwriteTabState': await this.overwriteTabState(chosenState); break;
                case 'wt.tabStates.restoreState': await this.restoreState(chosenState); break;
                case 'wt.tabStates.renameState': await this.renameState(chosenState); break;
            }
        }
        this.update();
    }
    
    registerCommands () {
        vscode.commands.registerCommand('wt.tabStates.saveCurrentState', () => this.runCommand('wt.tabStates.saveCurrentState'));
        vscode.commands.registerCommand('wt.tabStates.overwriteTabState', () => this.runCommand('wt.tabStates.overwriteTabState'));
        vscode.commands.registerCommand('wt.tabStates.restoreState', () => this.runCommand('wt.tabStates.restoreState'));
        vscode.commands.registerCommand('wt.tabStates.renameState', () => this.runCommand('wt.tabStates.renameState'));        
        vscode.commands.registerCommand('wt.tabStates.newEmptyGroup', () => this.runCommand('wt.tabStates.newEmptyGroup'));
        vscode.commands.registerCommand('wt.tabStates.showStatusBarMenu', () => this.showStatusBarMenu());
        vscode.commands.registerCommand('wt.tabStates.hideStatusBar', () => {
            this.statusBar.hide();
        });
        vscode.commands.registerCommand('wt.tabStates.showStatusBar', () => {
            this.statusBar.show();
        })
    }

    getPackageItems(): Partial<DiskContextType> {
        if (this.latestTabState) {
            return {
                'wt.tabStates.savedTabStates': this.savedTabStates,
                "wt.tabStates.latestTabState": this.latestTabState,
            }
        }
        else {
            return { 
                'wt.tabStates.savedTabStates': this.savedTabStates,
            }
        }
    }
}