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

export class FragmentLinker implements vscode.DocumentLinkProvider, Timed {

    
    private static urlMainRegex = /(https?|ftp):\/\/[^\s\/$.?#].[^\s]*/ig;
    private static urlRegex = / /g;

    public static fragmentLinkRanges: vscode.Range[] = [];
    public static urlRanges: vscode.Range[] = [];

    enabled: boolean;
    constructor (private context: vscode.ExtensionContext) {

        this.enabled = true;

        FragmentLinker.urlRegex = new RegExp(`${extension.wordSeparator}(?<link>${FragmentLinker.urlMainRegex.source})${extension.wordSeparator}`, 'gi');

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

    async gatherLinks (document: vscode.TextDocument): Promise<[ vscode.DocumentLink[], vscode.DocumentLink[] ]> {

        const fragmentLinks: vscode.DocumentLink[] = [];
        const urlLinks: vscode.DocumentLink[] = [];

        const lineText = document.getText();

        FragmentLinker.fragmentLinkRanges = [];

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
    
            const range = new vscode.Range(
                document.positionAt(start),
                document.positionAt(end)
            );

            fragmentLinks.push({
                target: uri,
                range: range
            });
            FragmentLinker.fragmentLinkRanges.push(range);
        }

        FragmentLinker.urlRanges = [];
        while ((match = FragmentLinker.urlRegex.exec(lineText)) !== null) {
            if (!match || match.index === undefined) continue;

            const link = match?.groups?.['link'];
            if (!link || link.length === 0) continue;

            const matchStartsAtWordSeparator = link[0] === match[0][0];
            const offset = matchStartsAtWordSeparator ? 0 : 1;

            const start = match.index + offset;
            const end = start + link.length;

            const range = new vscode.Range(
                document.positionAt(start),
                document.positionAt(end)
            );
            urlLinks.push({
                target: vscode.Uri.parse(link),
                range: range
            });
            FragmentLinker.urlRanges.push(range);
        }


        return [ fragmentLinks, urlLinks ];
    }

    async update(editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        const _ = await this.gatherLinks(editor.document);
        editor.setDecorations(notebookDecorations, FragmentLinker.fragmentLinkRanges);
        editor.setDecorations(notebookDecorations, FragmentLinker.urlRanges);
    }

    async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> {
        const [ fragmentLinks, urlLinks ] = await this.gatherLinks(document);
        return [ ...fragmentLinks, ...urlLinks  ]
    }
}