import * as vscode from 'vscode';
import { Notebook } from './../notebook/notebook';
import * as extension from '../extension';
import { v4 as uuidv4 } from 'uuid';
import { Buff } from '../Buffer/bufferSource';
import { SerializedNote } from '../notebook/notebookApi/notebookSerializer';


const aliasesSplitter = /-- Enter ALIASES for .* here, separated by semicolons -- ALSO, DON'T DELETE THIS LINE!/;
const appearancesSplitter = /-- Enter APPEARANCE descriptions for .* here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!/;
const generalSplitter = /-- Enter GENERAL DESCRIPTIONS for .* here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!/;




export interface Note {
    kind: 'note';
    noteId: string;
    noun: string;
    appearance: string[];
    aliases: string[];
    description: string[];
    uri: vscode.Uri;
}

export interface AppearanceContainer {
    kind: 'appearanceContainer';
    noteId: string;
    appearances: SubNote[];
}

export interface SubNote {
    kind: 'description' | 'appearance';
    idx: number;
    noteId: string;
    description: string;
}

export interface NoteMatch {
    range: vscode.Range;
    note: Note;
}


function getNoteText (note: Note): string {
    const aliasesText = note.aliases
        .map(alias => alias.trim().replace(';', '\\;'))
        .join('; ')

    const appearancesText = note.appearance
        .join('\n\n');

    const descriptionsText = note.description
        .join('\n\n');

    return `${note.noun}

-- Enter ALIASES for ${note.noun} here, separated by semicolons -- ALSO, DON'T DELETE THIS LINE!
${aliasesText}

-- Enter APPEARANCE descriptions for ${note.noun} here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!
${appearancesText}

-- Enter GENERAL DESCRIPTIONS for ${note.noun} here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!
${descriptionsText}
`;
}

function readSingleNote (noteId: string, content: string, uri: vscode.Uri): Note {
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
        noun: nameReal,
        uri: uri,
    };
}

async function readNotebook (notebookPath: vscode.Uri): Promise<Note[]> {
    try {

        try {
            await vscode.workspace.fs.stat(notebookPath);
        }
        catch (err: any) {
            // If the stat fails, then make the container directory and an empty config file
            await vscode.workspace.fs.createDirectory(notebookPath);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(notebookPath, '.gitkeep'), Buff.from(""));
        }

        const folders = await vscode.workspace.fs.readDirectory(notebookPath);
        const readPromises: Thenable<{
            noteId: string,
            content: string,
            uri: vscode.Uri
        } | null>[] = folders.map(([ name, ft ]) => {
            if (ft !== vscode.FileType.File || !name.endsWith('wtnote')) {
                return new Promise((resolve, reject) => resolve(null));
            }
            const noteId = name.replace('.wtnote', '');
            const pathUri = vscode.Uri.joinPath(notebookPath, name)
            return vscode.workspace.fs.readFile(pathUri).then(buff => {
                return {
                    noteId: noteId,
                    content: extension.decoder.decode(buff),
                    uri: pathUri
                }
            });
        });

        const notebook: Note[] = [];

        const contents = await Promise.all(readPromises);
        for (const data of contents) {
            if (data === null) continue;
            const { content, noteId, uri } = data;
            const singleNote = readSingleNote(noteId, content, uri);
            if (singleNote.noun === '' || !singleNote.noun) {
                continue;
            }
            notebook.push(singleNote);
        }

        return notebook;
    }
    catch (err: any) {
        vscode.window.showWarningMessage(`[WARNING] An error occurred while world notebook from disk: ${err.message}.  Creating a new world notebook file instead.`);
        console.log(err);
        return [];
    }
}


export async function wbToNb (workBibleFolderPath: vscode.Uri, notebookUriPath: vscode.Uri): Promise<vscode.Uri[]> {
    const results: vscode.Uri[] = [];
    const read = await readNotebook(workBibleFolderPath);
    for (const note of read) {
        if (note.noun === '') {
            continue;
        }

        const serializedNote: SerializedNote = {
            noteId: note.noteId,
            title: {
                editing: false,
                text: note.noun
            },
            headers: [
                {
                    headerOrder: 0,
                    headerText: 'aliases',
                    cells: [{
                        text: note.aliases.join("\n\n"),
                        editing: true,
                    }],
                },
                {
                    headerOrder: 0,
                    headerText: 'appearances',
                    cells: [{
                        text: note.appearance.join("\n\n"),
                        editing: true,
                    }],
                },
                {
                    headerOrder: 0,
                    headerText: 'notes',
                    cells: [{
                        text: note.description.join("\n\n"),
                        editing: true,
                    }]
                },
            ]
        };
        const jsonNote = JSON.stringify(serializedNote, undefined, 4);
        const newUri = vscode.Uri.joinPath(notebookUriPath, `${note.noteId}.wtnote`);
        await vscode.workspace.fs.writeFile(newUri, Buff.from(jsonNote));
        results.push(newUri);
    }
    return results;
}