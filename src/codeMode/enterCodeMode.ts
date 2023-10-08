import * as vscode from 'vscode';
import { CoderModer } from './codeMode';

export async function enter (this: CoderModer): Promise<void> {

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (!this.repoUris) return;

    this.openedCodeUris = [];

    for (const group of vscode.window.tabGroups.all) {
        
        // Select a random uri from this.repoUris to open
        //      in this tab group
        const uri = this.repoUris.sort(() => 0.5 - Math.random())[0];
        this.openedCodeUris.push(uri);
        
        const targetLocation = group.viewColumn;
        vscode.window.showTextDocument(uri, {
            viewColumn: targetLocation,
        });
    }
    this.state = 'codeMode';
}