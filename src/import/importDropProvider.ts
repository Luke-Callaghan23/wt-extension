import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { rootPath } from '../extension';
import { Workspace } from '../workspace/workspace';
import * as console from '../vsconsole';
import { Entry, ImportFileSystemView } from './importFileSystemView';

export class ImportDocumentProvider implements vscode.DocumentDropEditProvider, vscode.TreeDragAndDropController<Entry> {

    constructor (
        private workspaceFolder: vscode.Uri,
        private workspace: Workspace,
        private fsView: ImportFileSystemView
    ) {
    }

    dropMimeTypes = ['text/uri-list'];
    dragMimeTypes = [];

    
    public async handleDrop(target: Entry | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const targ = target;    
        const transferItem = dataTransfer.get('text/uri-list');
		if (!transferItem) {
			return;
		}

        // Get the destination of the copy, depending on where the drop occurred
        let dest: vscode.Uri;
        if (!targ) {
            // If there was no specific drop location, use the root import folder
            dest = this.workspace.importFolder;
        }
        else if (targ.type === vscode.FileType.Directory) {
            // If the drop point was a directory, use that directory path
            dest = targ.uri;
        }
        else if (targ.type === vscode.FileType.File) {
            // If the drop point was a file, get the path of the directory that file lives in
            dest = <vscode.Uri>vscodeUris.Utils.dirname(<vscodeUris.URI>targ.uri);
        }
        else {
            throw new Error("not implemented");
        }

        // As far as I can tell, the only way that vscode will give us the uris of dropped items
        //      is in this psychotic format: { value: uglyString, id: uuid }
        // uglyString:
        //      Ugly string is a single string that represents multiple uris
        //      Uris are joined on a newline (system specific (ofc))
        //      Uris are also prefixed with 'vscode-local:/'
        //      Uris are also encoded as they would be after a call to encodeURI 
        //          Plus some extra shenanigans
        // Why, microsoft?
        // Why?
        
        // Split the uris on the prefix 'vscode-local:/'
        const uris = transferItem.value.split('vscode-local:/');
        for (let uri of uris) {
            // Uri list will always begin with an empty string (string.split shenanigans)
            if (uri.length === 0) continue;
            
            // Linux subsystems have annoying prefixes -- need to get rid of those
            if ((uri as string).includes('home/')) {
                uri = '/home/' + uri.split('home/')[1];
            }

            // Replace the newline stuff (use \s and replace all because windows uses \r\n instead
            //      of just \n)
            uri = uri.replaceAll(/\s/g, '');

            // Undecode the uri
            uri = decodeURI(uri);
            // Colons are also encoded (decodeUri does not decode colons)
            uri = uri.replaceAll('%3A', ':');

            
            try {
                const ext = uri.slice(uri.lastIndexOf('.') + 1)[1];
                const uriName = uri.slice(uri.lastIndexOf('/'))[1];
                if (!this.workspace.importFileTypes.find(allowed => allowed === ext)) {
                    vscode.window.showWarningMessage(`Warning: Skipping '${uriName}' because its ext type '${ext}' is not valid for importing!`);
                    continue;
                }


                const finalDest = vscode.Uri.joinPath(dest, uriName);
                await vscode.workspace.fs.copy(uri, finalDest);
                this.fsView.refresh();
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error: copying file '${uri}': ${e}`);
            }
        }
    }

    public async handleDrag (source: Entry[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        throw new Error('Not implemented');
	}


    provideDocumentDropEdits (
        document: vscode.TextDocument, 
        position: vscode.Position, 
        dataTransfer: vscode.DataTransfer, 
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentDropEdit> {
        return undefined;
    }
}