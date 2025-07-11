import * as vscode from 'vscode';
import * as console from './miscTools/vsconsole';
import { defaultProgress } from './miscTools/help';


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
        return defaultProgress("Commiting All Files", async () => {
            await vscode.commands.executeCommand('git.commitAll');
        });
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while making commit: ${e}`);
        console.log(`${e}`);
    }
}

export async function gitCommitFile () {
    try {
        return defaultProgress("Commiting All Files", async () => {
            await vscode.commands.executeCommand('git.stage');
            await vscode.commands.executeCommand('git.commit');
        });
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while making commit: ${e}`);
        console.log(`${e}`);
    }
}