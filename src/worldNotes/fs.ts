import * as vscode from 'vscode';
import { Note, WorldNotes } from './worldNotes';
import * as extension from './../extension';
import { v4 as uuidv4 } from 'uuid';

export async function readNotes (this: WorldNotes, worldNotesPath: vscode.Uri): Promise<Note[]> {
    try {
        const data = await vscode.workspace.fs.readFile(worldNotesPath);
        const notesJSON = extension.decoder.decode(data);
        const notes: Note[] = JSON.parse(notesJSON);

        const result: Note[] = [];
        for (const note of notes) {

            let noun: string = '';
            if (note.noun && typeof note.noun === 'string') {
                noun = note.noun;
            }

            let aliases: string[] = [];
            if (note.aliases && Array.isArray(note.aliases)) {
                aliases = note.aliases.map(alias => alias + '');
            }

            let descriptions: string[] = [];
            if (note.descriptions && Array.isArray(note.descriptions)) {
                descriptions = note.descriptions.map(desc => desc + '');
            }

            result.push({
                kind: 'note',
                noteId: WorldNotes.getNewNoteId(),
                noun: noun,
                aliases: aliases,
                descriptions: descriptions,
            });
        }
        return result;
    }
    catch (err: any) {
        vscode.window.showWarningMessage(`[WARNING] An error occurred while world notes from disk: ${err.message}.  Creating a new world notes file instead.`);
        console.log(err);

        // Write an empty array to disk for the world notes
        vscode.workspace.fs.writeFile(worldNotesPath, extension.encoder.encode('[]'));
        return [];
    }
}


export async function writeNotes (this: WorldNotes, worldNotesPath: vscode.Uri): Promise<void> {
    try {
        // Get only the writeable fields for each note
        const writeable: {
            noun: string, 
            aliases: string[],
            descriptions: string[]
        }[] = [];
        for (const { noun, aliases, descriptions } of this.notes) {
            writeable.push({ noun, aliases, descriptions });
        }

        // Write the writeables to disk
        const notesJSON = JSON.stringify(writeable);
        const encoded = extension.encoder.encode(notesJSON);
        await vscode.workspace.fs.writeFile(worldNotesPath, encoded);
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`[ERR] An error occurred while writing notes to disk: ${err.message}`);
        console.log(err);
    }
}

