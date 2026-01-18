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


const commitMessage = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
);
commitMessage.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
commitMessage.text = `Committing All Files $(loading~spin)`;
commitMessage.tooltip = new vscode.MarkdownString(`
### (WTANIWE) Saving all recently updated files, including configuration files and modified text, to git
- Write your commit message on the first line of the commit editor.
- Hit "Commit" in the bottom right hand corner.
- Then you can sync to an external repository or keep your work local.`
);

export async function gitCommit () {
    try {
        commitMessage.show();
        await vscode.commands.executeCommand('git.commitAll');
        commitMessage.hide()
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while making commit: ${e}`);
        console.log(`${e}`);
    }
}

export async function gitCommitFile () {
    try {
        commitMessage.show();
        await vscode.commands.executeCommand('git.stage');
        await vscode.commands.executeCommand('git.commit');
        commitMessage.hide();
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR: An error occurred while making commit: ${e}`);
        console.log(`${e}`);
    }
}