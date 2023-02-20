import * as vscode from 'vscode';
import * as console from './vsconsole';
import * as childProcess from 'child_process';
import * as extension from './extension';


export async function gitiniter () {
    try {
        await vscode.commands.executeCommand('git.init');
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while initializing git repo: ${e}`);
        console.log(`${e}`);
    }
}

export async function gitCommitAll () {
    try {
        await vscode.commands.executeCommand('git.commitAll');
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while making commit: ${e}`);
        console.log(`${e}`);
    }
}

export async function gitCommitFile () {
    try {
        await vscode.commands.executeCommand('git.stage');
        await vscode.commands.executeCommand('git.commit');
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while making commit: ${e}`);
        console.log(`${e}`);
    }
}