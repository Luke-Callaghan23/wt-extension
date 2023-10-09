import * as vscode from 'vscode';
import { WorldNotes } from './worldNotes';
import * as console from '../vsconsole';

export function provideHover(
    this: WorldNotes,
    document: vscode.TextDocument, 
    position: vscode.Position, 
    token: vscode.CancellationToken
): vscode.ProviderResult<vscode.Hover> {
    if (!this.matchedNotes) return null;
    if (this.matchedNotes.docUri.fsPath !== document.uri.fsPath) return null;

    const matchedNote = this.matchedNotes.matches.find(match => match.range.contains(position));
    if (!matchedNote) return null;

    this.view.reveal(matchedNote.note, {
        select: true,
        expand: true,
    });

    return null;
}