import * as vscode from 'vscode';
import { CoderModer } from './codeMode';
import { Buff } from '../../Buffer/bufferSource';
import { isText } from 'istextorbinary';

export async function enter (this: CoderModer): Promise<void> {

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (!this.repoUris) return;

    this.openedCodeUris = [];

    let idx = 0;
    this.repoUris = this.repoUris.sort(() => 0.5 - Math.random());
    
    // 
    for (const group of vscode.window.tabGroups.all) {
        
        // Select a random uri from this.repoUris to open
        //      in this tab group
        
        let uri = this.repoUris[idx++];
        while (true) {
            const buf = await vscode.workspace.fs.readFile(uri);
            if (isText(null, Buff.from(buf))) break;
            uri = this.repoUris[idx++];
        }
        this.openedCodeUris.push(uri);
        
        const targetLocation = group.viewColumn;
        vscode.window.showTextDocument(uri, {
            viewColumn: targetLocation,
        });
    }

    // Open output menu in bottom pane, file explorer in side pane
    vscode.commands.executeCommand('workbench.action.output.toggleOutput');
    vscode.commands.executeCommand('workbench.view.explorer')


    this.state = 'codeMode';
}