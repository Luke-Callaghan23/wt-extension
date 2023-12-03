import * as vscode from 'vscode';
import { WorkBible } from './workBible';

export function provideDefinition(
    this: WorkBible, 
    document: vscode.TextDocument, 
    position: vscode.Position, 
    token: vscode.CancellationToken
): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    if (!this.matchedNotes) return null;
    if (this.matchedNotes.docUri.fsPath !== document.uri.fsPath) return null;

    const matchedNote = this.matchedNotes.matches.find(match => match.range.contains(position));
    if (!matchedNote) return null;

    this.view.reveal(matchedNote.note, {
        select: true,
        expand: true,
    });


    return {
        uri: vscode.Uri.file(`/home/luke-callaghan/dev/node/vscode/wt/envs/new-text-env/data/snips/snip-1701228481838-8d186827-a93a-4b4c-ab43-c8813a205fcc/fragment-1701228481939-fb3bfb79-e810-4589-bf64-cfe112e6a0df.wt`),
        range: new vscode.Range(position, position)
    };
}