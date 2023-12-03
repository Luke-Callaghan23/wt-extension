import * as vscode from 'vscode';
import { Note, WorkBible } from './workBible';
import * as extension from '../extension';
import { v4 as uuidv4 } from 'uuid';
import { getNoteText } from './editNote';

export async function readNotes (this: WorkBible, workBiblePath: vscode.Uri): Promise<Note[]> {
    try {

        const example: Note[] = [
            {
                "noun": "Tom Tomington",
                "aliases": [
                    "Tommy",
                    "Tomster",
                    "The Dark Lord",
                    "The boy who lived"
                ],
                "descriptions": [
                    "Tommy is a guy in the story who does things",
                    "Tommy is a Dark Lord who genocides people and what not",
                    "Tommy's hobbies include knitting and supporting his local shelter"
                ],
                noteId: WorkBible.getNewNoteId(),
                kind: 'note',
                appearance: [
                    'blue eyes',
                    'blonde hair',
                    "who's surprised"
                ]
            },
            {
                "noun": "Tim Timington",
                "aliases": [
                    "Timmy",
                    "Timster",
                    "T Man",
                    "The Dark Lord"
                ],
                "descriptions": [
                    "Timmy is a guy in the story who does things"
                ],
                noteId: WorkBible.getNewNoteId(),
                kind: 'note',
                appearance: [
                    'beeop', 'bop'
                ]
            },
            {
                "noun": "Lizzard Lundard",
                "aliases": [
                    "pingle",
                    "poop",
                    "clang"
                ],
                "descriptions": [
                    "Evil serpent queen :O",
                    "Clarg"
                ],
                noteId: WorkBible.getNewNoteId(),
                kind: 'note',
                appearance: [
                    'plorb'
                ]
            },
            {
                "noun": "bloop",
                "aliases": [],
                "descriptions": [
                    "blang",
                    "awl;kda;wl"
                ],
                noteId: WorkBible.getNewNoteId(),
                kind: 'note',
                appearance: []
            },
            {
                "noun": "clingle",
                "aliases": [],
                "descriptions": [
                    "clinglo",
                    "aw;lkd"
                ],
                noteId: WorkBible.getNewNoteId(),
                kind: 'note',
                appearance: [
                    'Eiusmod labore eu exercitation fugiat veniam duis amet non minim fugiat reprehenderit. Occaecat adipisicing officia qui incididunt non cupidatat ut fugiat aute qui deserunt anim dolor ad. Velit amet laboris irure consequat Lorem est consequat consequat ut esse incididunt cupidatat veniam adipisicing. Reprehenderit labore dolore esse amet magna quis pariatur dolore eu dolor aliquip veniam sunt.',
                    'Irure',
                    'irure ',
                    'cillum ',
                    'id ',
                    'in ',
                    'dolore ',
                    'occaecat ',
                    'culpa. ',
                    'Ipsum ',
                    'non ',
                    'reprehenderit ',
                    'quis ',
                    'incididunt ',
                    'cupidatat tempor excepteur proident nisi. Pariatur amet reprehenderit veniam anim excepteur nulla officia nostrud officia ipsum ea elit reprehenderit laboris. Ex culpa adipisicing in officia in officia magna culpa culpa tempor dolor sit.',
                ]
            },
            {
                "noun": "Kingdom of Kings",
                "aliases": [
                    "KoK"
                ],
                "descriptions": [
                    "Generic fantasy kingdom with kings"
                ],
                noteId: WorkBible.getNewNoteId(),
                kind: 'note',
                appearance: []
            }
        ]


        // const data = await vscode.workspace.fs.readFile(worldNotesPath);
        // const notesJSON = extension.decoder.decode(data);
        // const notes: Note[] = JSON.parse(notesJSON);

        // const result: Note[] = [];
        // for (const note of notes) {

        //     let noun: string = '';
        //     if (note.noun && typeof note.noun === 'string') {
        //         noun = note.noun;
        //     }

        //     let aliases: string[] = [];
        //     if (note.aliases && Array.isArray(note.aliases)) {
        //         aliases = note.aliases.map(alias => alias + '');
        //     }

        //     let descriptions: string[] = [];
        //     if (note.descriptions && Array.isArray(note.descriptions)) {
        //         descriptions = note.descriptions.map(desc => desc + '');
        //     }

        //     result.push({
        //         kind: 'note',
        //         noteId: WorkBible.getNewNoteId(),
        //         noun: noun,
        //         aliases: aliases,
        //         descriptions: descriptions,
        //     });
        // }
        // return result;
        return example
    }
    catch (err: any) {
        // vscode.window.showWarningMessage(`[WARNING] An error occurred while world notes from disk: ${err.message}.  Creating a new world notes file instead.`);
        // console.log(err);

        // // Write an empty array to disk for the world notes
        // vscode.workspace.fs.writeFile(worldNotesPath, extension.encoder.encode('[]'));
        // return [];
        return [];
    }
}


export async function writeNotes (this: WorkBible, worldNotesPath: vscode.Uri): Promise<void> {
    throw `not implemented`;
    // try {
    //     // Get only the writeable fields for each note
    //     const writeable: {
    //         noun: string, 
    //         aliases: string[],
    //         descriptions: string[]
    //     }[] = [];
    //     for (const { noun, aliases, descriptions } of this.notes) {
    //         writeable.push({ noun, aliases, descriptions });
    //     }

    //     // Write the writeables to disk
    //     const notesJSON = JSON.stringify(writeable);
    //     const encoded = extension.encoder.encode(notesJSON);
    //     await vscode.workspace.fs.writeFile(worldNotesPath, encoded);
    // }
    // catch (err: any) {
    //     vscode.window.showErrorMessage(`[ERR] An error occurred while writing notes to disk: ${err.message}`);
    //     console.log(err);
    // }
}



export async function writeSingleNote (this: WorkBible, note: Note): Promise<void> {
    const noteText = getNoteText(note);

    const noteFileName = `${note.noteId}.wtnote`
    const notePath = vscode.Uri.joinPath(this.workBibleFolderPath, noteFileName);

    try {
        const encodedNote = extension.encoder.encode(noteText);
        await vscode.workspace.fs.writeFile(notePath, encodedNote);
        const document = await vscode.workspace.openTextDocument(notePath);
        vscode.window.showTextDocument(document);
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`[ERRROR]: An error occurred while writing note for '${note.noun}' to '${notePath}': ${err.message}`);
        return;
    }
}