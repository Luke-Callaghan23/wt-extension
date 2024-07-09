import * as vscode from 'vscode';
import { CoderModer } from './codeMode';
import { TabLabels } from '../tabLabels/tabLabels';
import { OutlineView } from '../outline/outlineView';
import { compareFsPath } from '../help';

export async function exit (this: CoderModer): Promise<void> {
    if (!this.repoUris) return;

    // #240 -- idk man
    // For some reason, `vscode.window.tabGroups.close` won't work two times in a row any more
    //      not sure if it can't work in different tab groups or what
    // For some other reason, simply letting the exception happen, then running again fixes it
    // Hacky workaround is to run the code for closing tabs nine times (once for every potential
    //      tab group (and therefore every opened tab that needs to be closed)) and breaking early 
    //      if we do close all the tabs
    for (let i = 0; i < 9; i++) {
        try {
            for (const group of vscode.window.tabGroups.all) {
                
                // Select a random uri from this.repoUris to open
                //      in this tab group
                
                // All tabs open in the current group
                const ind = group.tabs.findIndex(tab => {
                    return this.openedCodeUris.find(opened => 
                        tab.input instanceof vscode.TabInputText && compareFsPath(tab.input.uri, opened)
                    );
                });
        
                if (ind === -1) continue;
                const tab = group.tabs[ind];
                await vscode.window.tabGroups.close(tab);
            }
            break;
        }
        catch (err: any) {}
    }

    // Bring back terminal in bottom pane and writing tool in side pane
    if (this.openedExplorer) {
        vscode.commands.executeCommand('workbench.view.extension.wt');
    }
    if (this.openedOutput) {
        vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
    }
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    
    this.openedCodeUris = [];
    this.state = 'noCodeMode';
    this.openedExplorer = false;
    this.openedOutput = false;
    
    if (this.previousActiveDocument && this.previousActiveViewColumn) {
        await vscode.window.showTextDocument(this.previousActiveDocument, {
            viewColumn: this.previousActiveViewColumn
        });
        this.previousActiveDocument = null;
        this.previousActiveViewColumn = null;
    }
    

    // Once full swapped into writing mode, then re-assign labels for all opened tabs
    await TabLabels.assignNamesForOpenTabs();
}