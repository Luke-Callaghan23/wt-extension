import * as vscode from 'vscode';
import { WorkBible } from './workBible';
import * as console from '../vsconsole';
import { compareFsPath } from '../help';

export function provideHover(
    this: WorkBible,
    document: vscode.TextDocument, 
    position: vscode.Position, 
    token: vscode.CancellationToken
): vscode.ProviderResult<vscode.Hover> {
    if (!this.matchedNotes) return null;
    if (!compareFsPath(this.matchedNotes.docUri, document.uri)) return null;

    const matchedNote = this.matchedNotes.matches.find(match => match.range.contains(position));
    if (!matchedNote) return null;
    this.view.reveal(matchedNote.note, {
        select: true,
        expand: true,
    })
    return null;
}