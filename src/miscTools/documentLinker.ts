import * as vscode from 'vscode';
import { Packageable } from '../packageable';
import { DiskContextType } from '../workspace/workspaceClass';
import * as extension from '../extension';
import { FileAccessManager } from './fileAccesses';
import { searchFiles, selectFile, selectFragment } from './searchFiles';
import * as path from 'path'
import * as vscodeUri from 'vscode-uri';
import { vagueNodeSearch } from './help';
import { Timed, TimedView } from '../timedView';
import { notebookDecorations } from '../notebook/timedViewUpdate';

export const markdownFormattedFragmentLinkRegex = /\[(?<description>.*?)\]\((?<link>.*?)\)/g;

export class DocumentLinker implements vscode.DocumentLinkProvider, Timed {

    

    public static documentLinkRanges: vscode.Range[] = [];

    enabled: boolean;
    constructor (private context: vscode.ExtensionContext) {

        this.enabled = true;

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

    getUpdatesAreVisible(): boolean {
        return this.enabled;
    }

    static *generateLinkRanges (text: string): Generator<{
        start: number,
        end: number,
        link: string
    }> {
        let match: RegExpMatchArray | null;
        while ((match = extension.urlRegex.exec(text)) !== null) {
            if (!match || match.index === undefined) continue;

            const link = match?.groups?.['link'];
            if (!link || link.length === 0) continue;

            const matchStartsAtWordSeparator = link[0] === match[0][0];
            const offset = matchStartsAtWordSeparator ? 0 : 1;

            const start = match.index + offset;
            const end = start + link.length;

            yield { start, end, link };
        }
    }

    async gatherLinks (document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {

        const documentLinks: vscode.DocumentLink[] = [];

        const lineText = document.getText();

        DocumentLinker.documentLinkRanges = [];

        let match: RegExpMatchArray | null;
        while ((match = markdownFormattedFragmentLinkRegex.exec(lineText))) {
            if (!match || match.index === undefined) continue;

            const description = match.groups?.['description']
            const link = match.groups?.['link'];
            if (!description || !link) continue;

            const start = match.index;
            const end = match.index + match[0].length;
            
            // Valid uri for this link, if one exists
            // Can be either a fragment URI, or a web URL, depending on the format
            let uri: vscode.Uri | null;
            
            // If the link is a regular URL, then just transform it into a vscode.Uri
            if (extension.urlMainRegex.test(link)) {
                uri = vscode.Uri.parse(link);
            }
            // Otherwise, attempt to match the URL with a fragment by doing a vague node
            //      search on the uri
            else {
                const node = await vagueNodeSearch(vscode.Uri.file(link), true);
                if (!node || node.source === 'notebook') continue;
                uri = node.node!.data.ids.uri;
            }
    
            const range = new vscode.Range(
                document.positionAt(start),
                document.positionAt(end)
            );

            documentLinks.push({
                target: uri,
                range: range
            });
            DocumentLinker.documentLinkRanges.push(range);
        }

        for (const { start, end, link } of DocumentLinker.generateLinkRanges(lineText)) {
            const range = new vscode.Range(
                document.positionAt(start),
                document.positionAt(end)
            );
            documentLinks.push({
                target: vscode.Uri.parse(link),
                range: range
            });
            DocumentLinker.documentLinkRanges.push(range);
        }
        return documentLinks;
    }

    async update(editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        const _ = await this.gatherLinks(editor.document);
        editor.setDecorations(notebookDecorations, DocumentLinker.documentLinkRanges);
    }

    async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> {
        return this.gatherLinks(document);
    }
}