import * as vscode from 'vscode';
import * as console from './miscTools/vsconsole';


export async function gitiniter () {
    try {
        await vscode.commands.executeCommand('git.init');
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while initializing git repo: ${e}`);
        console.log(`${e}`);
    }
}

export async function gitCommit () {
    try {
        await vscode.commands.executeCommand('workbench.view.scm');
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while making commit: ${e}`);
        console.log(`${e}`);
    }
}