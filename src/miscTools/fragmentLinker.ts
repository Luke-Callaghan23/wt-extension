import * as vscode from 'vscode';
import { Packageable } from '../packageable';
import { DiskContextType } from '../workspace/workspaceClass';
import * as extension from '../extension';
import { FileAccessManager } from './fileAccesses';
import { searchFiles, selectFile, selectFragment } from './searchFiles';
import * as path from 'path'
import * as vscodeUri from 'vscode-uri';
import { vagueNodeSearch } from './help';

export const markdownFormattedFragmentLinkRegex = /\[(?<description>.*?)\]\((?<link>.*?)\)/g;

export class FragmentLinker implements vscode.DocumentLinkProvider {
    constructor (private context: vscode.ExtensionContext) {;
        this.context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({
            pattern: "**/*.wt",
            scheme: "file"
        }, this));

        this.context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({
            pattern: "**/*.wtnote",
        }, this));

        // this.context.subscriptions.push(vscode.languages.registerDocumentDropEditProvider)

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.fragmentLinker.insertLink', async () => {
            const fragment = await selectFragment();
            if (!fragment) return;

            const fileName = vscodeUri.Utils.basename(fragment.getUri());

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            for (const selection of editor.selections) {
                await editor.edit(eb => {
                    eb.replace(selection, `[${fragment.data.ids.display}](${fileName})`);
                });
            }
        }));
    }
    async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> {

        const links: vscode.DocumentLink[] = [];

        const lineText = document.getText();

        let match: RegExpMatchArray | null;
        while ((match = markdownFormattedFragmentLinkRegex.exec(lineText))) {
            if (!match || match.index === undefined) continue;

            const description = match.groups?.['description']
            const link = match.groups?.['link'];
            if (!description || !link) continue;

            const start = match.index;
            const end = match.index + match[0].length;
    
            const node = await vagueNodeSearch(vscode.Uri.file(link), true);
            if (!node || node.source === 'notebook') continue;
            const uri = node.node!.data.ids.uri;
    
            links.push({
                target: uri,
                range: new vscode.Range(
                    document.positionAt(start),
                    document.positionAt(end)
                )
            });
        }

        return links;
    }
}