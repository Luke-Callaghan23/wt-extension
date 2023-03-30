import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';

export class CompletionItemProvider implements vscode.CompletionItemProvider {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {

    }
}