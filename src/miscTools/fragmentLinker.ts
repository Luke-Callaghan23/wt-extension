import * as vscode from 'vscode';
import { Packageable } from '../packageable';
import { DiskContextType } from '../workspace/workspaceClass';
import * as extension from '../extension';
import { FileAccessManager } from './fileAccesses';
import { searchFiles, selectFile } from './searchFiles';
import * as path from 'path'
import * as vscodeUri from 'vscode-uri';

export class FragmentLinker {
    constructor () {
        vscode.languages.registerDefinitionProvider({
            pattern: "**/*.wt",
            scheme: "file"
        }, this);
        vscode.languages.registerDefinitionProvider({
            pattern: "**/*.wtNote",
            scheme: "file"
        }, this);

        vscode.commands.registerCommand('wt.fragmentLinker.insertLink', async () => {
            const fragment = await extension.ExtensionGlobals.outlineView.selectFile();
            if (!fragment) return;

            const fileName = vscodeUri.Utils.basename(fragment.getUri());

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            for (const selection of editor.selections) {
                await editor.edit(eb => {
                    eb.replace(selection, `[${fragment.data.ids.display}](${fileName})`);
                });
            }
        });
    }

    
    async provideDefinition (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition | vscode.DefinitionLink[]> {
        const startOfLine = new vscode.Position(position.line, 0);
        const endOfLine = document.positionAt(document.offsetAt(new vscode.Position(position.line + 1, 0)) - 1);
        
        const markdownLink = /\[(?<description>.*?)\]\((?<link>.*?)\)/;
        const lineText = document.getText(new vscode.Selection(startOfLine, endOfLine));
        const match = markdownLink.exec(lineText);
        if (match === null) return [];

        const description = match.groups?.['description']
        const link = match.groups?.['link'];
        if (!description || !link) return [];
        
        const fragment = await extension.ExtensionGlobals.outlineView.getTreeElementByUri(vscode.Uri.file(link), undefined, true);
        if (!fragment) return [];
        const uri = fragment.getUri();

        return {
            range: FileAccessManager.getPosition(uri) || new vscode.Selection(
                new vscode.Position(0, 0),
                new vscode.Position(0, 0)
            ),
            uri: uri,
        };
    }
}