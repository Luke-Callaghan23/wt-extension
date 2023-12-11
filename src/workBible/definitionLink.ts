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

    console.log(matchedNote);

    this.view.reveal(matchedNote.note, {
        select: true,
        expand: true,
    });

    const fileName = `${matchedNote.note.noteId}.wtnote`;
    const filePath = vscode.Uri.joinPath(this.workBibleFolderPath, fileName);
    return {
        uri: filePath,
        range: new vscode.Range(position, position)
    };
}