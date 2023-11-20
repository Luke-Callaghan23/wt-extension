import * as vscode from 'vscode';
import { CoderModer } from './codeMode';

export async function exit (this: CoderModer): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (!this.repoUris) return;

    for (const group of vscode.window.tabGroups.all) {
        
        // Select a random uri from this.repoUris to open
        //      in this tab group
        
        // All tabs open in the current group
        const ind = group.tabs.findIndex(tab => {
            return this.openedCodeUris.find(opened => 
                tab.input instanceof vscode.TabInputText 
                && tab.input.uri.fsPath === opened.fsPath
            );
        });

        if (ind === -1) continue;
        await vscode.window.tabGroups.close(group.tabs[ind]);
    }

    // Bring back terminal in bottom pane and writing tool in side pane
    vscode.commands.executeCommand('workbench.view.extension.wt').then(() => {
        vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal').then(() => {
            // Also focus the first editor group
            vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        })
    })


    this.openedCodeUris = [];
    this.state = 'noCodeMode';
}