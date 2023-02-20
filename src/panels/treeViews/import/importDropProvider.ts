import * as vscode from 'vscode';
import { Workspace } from '../../../workspace/workspace';
import * as console from './../../../vsconsole';
import { Entry } from './importFileSystemView';

export class ImportDocumentProvider implements vscode.DocumentDropEditProvider, vscode.TreeDragAndDropController<Entry> {

    constructor (
        private workspaceFolder: vscode.Uri,
        private workspace: Workspace,
    ) {
    }

    dropMimeTypes = ['application/vnd.code.tree.import', 'text/plain'];
    dragMimeTypes = ['text/uri-list', 'text/plain'];

    
    public async handleDrop(target: Entry | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const targ = target;
        const transferItem = dataTransfer.get('application/vnd.code.tree.outline');
		if (!transferItem) {
			return;
		}
        throw new Error('Method not implemented.');
    }

    public async handleDrag (source: Entry[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        console.log(treeDataTransfer);
		treeDataTransfer.set('application/vnd.code.tree.import', new vscode.DataTransferItem(source));
	}


    provideDocumentDropEdits (
        document: vscode.TextDocument, 
        position: vscode.Position, 
        dataTransfer: vscode.DataTransfer, 
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentDropEdit> {

        console.log('hiya');



        return undefined;
    }
}