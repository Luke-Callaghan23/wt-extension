import * as vscode from 'vscode';
import { Note, WorldNotes } from './worldNotes';


export async function searchNote (this: WorldNotes, resource: Note) {
    vscode.commands.executeCommand('workbench.action.findInFiles', {
        query: this.getNounPattern(resource, false),
        triggerSearch: true,
        filesToInclude: 'data/chapters/**, data/snips/**',
        isRegex: true,
        isCaseSensitive: false,
        matchWholeWord: true,
    });
}