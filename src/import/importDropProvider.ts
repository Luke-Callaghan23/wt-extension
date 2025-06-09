import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { Utils } from 'vscode-uri';
import { rootPath } from '../extension';
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../miscTools/vsconsole';
import { Entry, ImportFileSystemView } from './importFileSystemView';

export class ImportDocumentProvider implements vscode.DocumentDropEditProvider, vscode.TreeDragAndDropController<Entry> {

    constructor (
        private workspaceFolder: vscode.Uri,
        private workspace: Workspace,
        private fsView: ImportFileSystemView
    ) {
    }

    dropMimeTypes = ['text/uri-list'];
	dragMimeTypes = ['application/vnd.code.tree.import.fileexplorer'];

    
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

        // Split the uris on the prefix 'vscode-local:/'
        const uris: string[] = transferItem.value.split('\n');
        for (let unparsed of uris) {
            const uri = vscode.Uri.parse(unparsed.trim());
            const ext = Utils.extname(uri).replace('.', '');
            const basename = Utils.basename(uri);
            if (!this.workspace.importFileTypes.find(allowed => allowed === ext)) {
                vscode.window.showWarningMessage(`Warning: Skipping '${basename}' because its ext type '${ext}' is not valid for importing!`);
                continue;
            }

        
            const finalDest = vscode.Uri.joinPath(dest, basename);

            vscode.workspace.fs.readFile(uri);

            try {
                await vscode.workspace.fs.copy(uri, finalDest);
            }
            catch (err: any) {
                console.log(err);
            }
        }
        this.fsView.refresh();

    }

    public async handleDrag (source: Entry[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        treeDataTransfer.set('application/vnd.code.tree.import.fileexplorer', new vscode.DataTransferItem(source));
                
        const uris: vscode.Uri[] = source.map(src => src.uri).flat();
        const uriStrings = uris.map(uri => uri.toString());
        
        // Combine all collected uris into a single string
        const sourceUriList = uriStrings.join('\r\n');
        treeDataTransfer.set('text/uri-list', new vscode.DataTransferItem(sourceUriList));
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