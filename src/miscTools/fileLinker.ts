import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import { statFile } from './help';
import { FileAccessManager } from './fileAccesses';
import * as vscodeUri from 'vscode-uri'
import * as extension from '../extension';

export class FileLinker implements vscode.DefinitionProvider {
    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace
    ) {
        this.context.subscriptions.push(vscode.languages.registerDefinitionProvider({
            pattern: "**/.config",
            scheme: "file"
        }, this));

        this.context.subscriptions.push(vscode.languages.registerDefinitionProvider({
            pattern: "**/contextValues.json",
            scheme: "file"
        }, this));
    }

    async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition | vscode.DefinitionLink[]> {
        const text = document.getText();
        const offset = document.offsetAt(position);
        
        let startQuoteIndex: number | null = null;
        for (let travelDown = offset - 1; travelDown >= 0; travelDown--) {
            if (text[travelDown] === '"') {
                startQuoteIndex = travelDown;
                break;
            }
        }
        if (startQuoteIndex === null) return [];

        let endQuoteIndex: number | null = null;
        for (let travelUp = offset + 1; travelUp < text.length; travelUp++) {
            if (text[travelUp] === '"') {
                endQuoteIndex = travelUp;
                break;
            }
        }
        if (endQuoteIndex === null) return [];

        const quotedText = document.getText(new vscode.Range(
            document.positionAt(startQuoteIndex),
            document.positionAt(endQuoteIndex)
        )).replaceAll('"', '');

        let uri: vscode.Uri;
        if (document.uri.toString() === vscode.Uri.joinPath(extension.rootPath, 'data', 'contextValues.json').toString()) {
            uri = vscode.Uri.joinPath(extension.rootPath, quotedText);

            const stat = await statFile(uri);
            if (!stat || stat.type !== vscode.FileType.File) {
                return [];
            }
        }
        else {
            const directory = vscodeUri.Utils.dirname(document.uri);
            const fullUri = vscode.Uri.joinPath(directory, quotedText);
            if (!(await statFile(fullUri))) return [];

            uri = fullUri;
        }
        const destination = FileAccessManager.getPosition(uri) || new vscode.Selection(
            new vscode.Position(0, 0),
            new vscode.Position(0, 0)
        );
        return {
            range: destination,
            uri: uri
        }
    }
}