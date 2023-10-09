import * as vscode from 'vscode';
import { WorldNotes } from './worldNotes';

export function provideDefinition(
    this: WorldNotes, 
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
        uri: document.uri.with({ fragment: `noteId=${matchedNote.note.noteId}` }),
        range: new vscode.Range(position, position)
    };
}