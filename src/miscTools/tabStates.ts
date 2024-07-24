import * as vscode from 'vscode';
import { Workspace } from "../workspace/workspaceClass";
import { DiskContextType, SavedTabState, TabPositions } from '../workspace/workspace';
import { Packageable } from '../packageable';
import { FileAccessManager } from './fileAccesses';
import * as extension from './../extension';
import { TabLabels } from '../tabLabels/tabLabels';


type TabStateCommand = 'wt.tabStates.saveCurrentState' | 'wt.tabStates.overwriteTabState' | 'wt.tabStates.restoreState' | 'wt.tabStates.renameState';
export class TabStates implements Packageable {
    private savedTabStates: SavedTabState;
    constructor (private context: vscode.ExtensionContext, private workspace: Workspace) {
        this.savedTabStates = context.workspaceState.get('wt.tabStates.savedTabStates') || {};
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

    public static restoreTabState (tabContext: TabPositions) {
        (async () => {
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
        })();
    }

    private async saveCurrentState () {
        const created = Date.now();
        const stateName = await vscode.window.showInputBox({
            placeHolder: "Baby's first tab state",
            ignoreFocusOut: false,
            prompt: `Give a name to the current tab state so that you can return to it later`,
            title: 'Assign a Name'
        });
        if (!stateName) return;

        const currentState: TabPositions = TabStates.packageCurrentTabState();
        this.savedTabStates[stateName] = {
            created: created,
            positions: currentState
        };
    }

    private async chooseTabState (prompt: string): Promise<string | null> {
        const sortedStates = Object.entries(this.savedTabStates).sort(([_a, stateA], [_b, stateB]) => stateB.created - stateA.created);
        const stateNames = sortedStates.map(([ stateName, _state ]) => stateName);
        const tabStateName = await vscode.window.showQuickPick(stateNames, {
            canPickMany: false,
            ignoreFocusOut: false,
            matchOnDescription: true,
            matchOnDetail: true,
            title: prompt,
        });
        if (!tabStateName) return null;
        return tabStateName;
    }

    private async renameState () {
        const chosenState = await this.chooseTabState("Which tab state would you like to rename?");
        if (!chosenState) return;
        
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
    }

    private async overwriteTabState () {
        const created = Date.now();
        const chosenState = await this.chooseTabState("Which tab state would you like to overwrite with the current positions?");
        if (!chosenState) return;

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
    }

    private async restoreState () {
        const chosenState = await this.chooseTabState("Which tab state would you like to restore?");
        if (!chosenState) return;

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
        return TabStates.restoreTabState(this.savedTabStates[chosenState].positions);
    }

    private async runCommand (command: TabStateCommand) {
        const commands: { [index: string]: ()=>Promise<any> } = {
            'wt.tabStates.saveCurrentState': this.saveCurrentState,
            'wt.tabStates.overwriteTabState': this.overwriteTabState,
            'wt.tabStates.restoreState': this.restoreState,
            'wt.tabStates.renameState': this.renameState,
        }
        await commands[command]();
        this.context.workspaceState.update('wt.tabStates.savedTabStates', this.savedTabStates);
    }
    
    registerCommands () {
        vscode.commands.registerCommand('wt.tabStates.saveCurrentState', () => this.runCommand('wt.tabStates.saveCurrentState'));
        vscode.commands.registerCommand('wt.tabStates.overwriteTabState', () => this.runCommand('wt.tabStates.overwriteTabState'));
        vscode.commands.registerCommand('wt.tabStates.restoreState', () => this.runCommand('wt.tabStates.restoreState'));
        vscode.commands.registerCommand('wt.tabStates.renameState', () => this.runCommand('wt.tabStates.renameState'));
    }

    getPackageItems(): { ["wt.tabStates.savedTabStates"]: DiskContextType["wt.tabStates.savedTabStates"]; } {
        return { 'wt.tabStates.savedTabStates': this.savedTabStates }
    }
}