import * as vscode from 'vscode';
import * as extension from './../extension';
import { Workspace } from '../workspace/workspaceClass';

export class GitWatcher {

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace
    ) {
        const path = vscode.Uri.joinPath(extension.rootPath, '.git', '**').fsPath;
        const watcher = vscode.workspace.createFileSystemWatcher(path);
        // watcher.onDidChange((uri: vscode.Uri) => this.updateExtension(uri));
        watcher.onDidDelete((uri) => console.log(uri))
        watcher.onDidChange((uri) => console.log(uri))
    }

    async updateExtension (uri: vscode.Uri) {
        const response = await vscode.window.showInformationMessage("Git Update Detected", {
            modal: true,
            detail: "WTANIWE has detected an update in your local git directory.  Would you like to refresh the extension to reflect these changes?\nIn the case of a pull or a merge, this may mean the current opened files will be closed and replaced with the most recent edited files from the remote branch."
        }, "Refresh Extension", "Keep it");
        if (!response || response === 'Keep it') return;


    }

}