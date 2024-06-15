import * as vscode from 'vscode';
import { Note, WorkBible } from './workBible';
import * as extension from '../extension';
import { v4 as uuidv4 } from 'uuid';
import { getNoteText } from './editNote';
import { Buff } from '../Buffer/bufferSource';


const aliasesSplitter = /-- Enter ALIASES for .* here, separated by semicolons -- ALSO, DON'T DELETE THIS LINE!/;
const appearancesSplitter = /-- Enter APPEARANCE descriptions for .* here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!/;
const generalSplitter = /-- Enter GENERAL DESCRIPTIONS for .* here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!/;


export function readSingleNote (this: WorkBible, noteId: string, content: string): Note {
    // If the aliases splitter was not found, use the first newline as the separator instead
    let [ name, remaining ] = content.split(aliasesSplitter);
    if (remaining === undefined) {
        const newlineIdx = content.indexOf('\n');
        name = content.slice(0, newlineIdx);
        remaining = content.slice(newlineIdx+1).trim();
    }

    if (remaining === undefined) {
        remaining = '';
    }

    // If the appearances splitter was not found, use the first newline as the separator isntead
    let [ aliases, remaining2 ] = remaining.split(appearancesSplitter);
    if (remaining2 === undefined) {
        const newlineIdx = content.indexOf('\n');
        aliases = content.slice(0, newlineIdx);
        remaining2 = content.slice(newlineIdx+1).trim();
    }

    if (remaining2 === undefined) {
        remaining2 = '';
    }

    // If the general splitter was not found, use the first newline as the separator instead
    let [ appearances, descriptions ] = remaining2.split(generalSplitter);
    if (descriptions === undefined) {
        const newlineIdx = content.indexOf('\n');
        appearances = content.slice(0, newlineIdx);
        descriptions = content.slice(newlineIdx+1).trim();
    }

    if (descriptions === undefined) {
        descriptions = '';
    }

    // Since the note name and aliases both only use one line, find the content on the first line
    //      and use that
    let nameReal: string | undefined;
    name.split('\n').forEach(n => {
        n = n.trim();
        if (n.length === 0) return;
        if (nameReal === undefined) nameReal = n;
    });
    if (nameReal === undefined) nameReal = '';

    let aliasesReal: string | undefined;
    aliases.split('\n').forEach(n => {
        n = n.trim();
        if (n.length === 0) return;
        if (aliasesReal === undefined) aliasesReal = n;
    });
    if (aliasesReal === undefined) aliasesReal = '';

    const aliasesRealArr = aliasesReal!.split(';').map(alias => alias.trim());

    // Process multiline blocks
    const appearancesReal = appearances.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    const descriptionsReal = descriptions.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    return {
        noteId: noteId,
        aliases: aliasesRealArr,
        appearance: appearancesReal,
        description: descriptionsReal,
        kind: 'note',
        noun: nameReal
    };
}

export async function readNotes (this: WorkBible, workBiblePath: vscode.Uri): Promise<Note[]> {
    try {

        try {
            await vscode.workspace.fs.stat(this.workBibleFolderPath);
        }
        catch (err: any) {
            // If the stat fails, then make the container directory and an empty config file
            await vscode.workspace.fs.createDirectory(this.workBibleFolderPath);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.workBibleFolderPath, '.gitkeep'), Buff.from(""));
        }

        const folders = await vscode.workspace.fs.readDirectory(this.workBibleFolderPath);
        const readPromises: Thenable<{
            noteId: string,
            content: string
        } | null>[] = folders.map(([ name, ft ]) => {
            if (ft !== vscode.FileType.File || !name.endsWith('wtnote')) {
                return new Promise((resolve, reject) => resolve(null));
            }
            const noteId = name.replace('.wtnote', '');
            console.log(noteId);
            const path = vscode.Uri.joinPath(this.workBibleFolderPath, name)
            return vscode.workspace.fs.readFile(path).then(buff => {
                return {
                    noteId: noteId,
                    content: extension.decoder.decode(buff),
                }
            });
        });

        const notes: Note[] = [];

        const contents = await Promise.all(readPromises);
        for (const data of contents) {
            if (data === null) continue;
            const { content, noteId } = data;
            notes.push(this.readSingleNote(noteId, content));
        }

        return notes;
    }
    catch (err: any) {
        vscode.window.showWarningMessage(`[WARNING] An error occurred while world notes from disk: ${err.message}.  Creating a new world notes file instead.`);
        console.log(err);
        return [];
    }
}


export async function writeNotes (this: WorkBible): Promise<void> {
    try {
        const writePromises = this.notes.map(note => {
            return this.writeSingleNote(note);
        });
        await Promise.all(writePromises);
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`[ERR] An error occurred while writing notes to disk: ${err.message}`);
        console.log(err);
    }
}



export async function writeSingleNote (this: WorkBible, note: Note): Promise<vscode.Uri | null> {
    const noteText = getNoteText(note);

    const noteFileName = `${note.noteId}.wtnote`
    const notePath = vscode.Uri.joinPath(this.workBibleFolderPath, noteFileName);

    try {
        const encodedNote = extension.encoder.encode(noteText);
        await vscode.workspace.fs.writeFile(notePath, encodedNote);
        return notePath;
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`[ERRROR]: An error occurred while writing note for '${note.noun}' to '${notePath}': ${err.message}`);
        return null;
    }
}