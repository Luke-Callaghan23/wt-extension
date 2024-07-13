import * as vscode from 'vscode';
import { WorkBible } from './workBible';
import { compareFsPath } from '../help';

export function provideDefinition(
    this: WorkBible, 
    document: vscode.TextDocument, 
    position: vscode.Position, 
    token: vscode.CancellationToken
): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    if (!this.matchedNotes) return null;
    if (!compareFsPath(this.matchedNotes.docUri, document.uri)) return null;

    const matchedNote = this.matchedNotes.matches.find(match => match.range.contains(position));
    if (!matchedNote) return null;

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