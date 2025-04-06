import * as vscode from 'vscode';
import { AppearanceContainer, Note, SubNote, Notebook } from './notebook';
import { TabLabels } from '../tabLabels/tabLabels';
import { determineAuxViewColumn } from '../miscTools/help';
import { Buff } from '../Buffer/bufferSource';
import * as extension from './../extension';
import { SerializedNote } from './notebookApi/serializer';

export async function addNote (this: Notebook, resource: Note | undefined): Promise<string | null> {
    const noun = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: 'Tom Tomington',
        prompt: `Enter the name for the new note: `,
    });
    if (noun === undefined || noun === null || noun.length === 0) return null;

    const noteId = Notebook.getNewNoteId();
    const notePath = vscode.Uri.joinPath(this.notebookFolderPath, `${noteId}.wtnote`);
    const insert: Note = {
        noun: noun,
        description: [],
        appearance: [],
        aliases: [],
        kind: 'note',
        noteId: noteId,
        uri: notePath
    };

    let idx: number; 
    if (resource !== undefined) {
        // Find the index of the note that was clicked on to add this new note, so that
        //      we can insert this note right after
        idx = this.notebook.findIndex(selected => selected.noteId === resource.noteId);
        if (idx === -1) idx = this.notebook.length;
    }
    else {
        // If the plus button in the header was hit, then resource === undefined
        // Insert the new note at the end of the note list
        idx = this.notebook.length-1;
    }

    // Push the note in the selected index
    this.notebook = [
        ...this.notebook.slice(0, idx+1),
        insert,
        ...this.notebook.slice(idx+1)
    ];
    this.refresh();
    this.writeSingleNote(insert).then(result => {
        if (result === null) return;
        vscode.workspace.openTextDocument(result).then(async document => {
            vscode.window.showTextDocument(document, {
                viewColumn: await determineAuxViewColumn((uri) => this.getNote(uri))
            });
        });
    })


    return insert.noteId;
}

export async function removeNote (this: Notebook, resource: Note): Promise<string | null> {
    const no = 'No';
    const yes = 'Yes';
    const areYouSure = await vscode.window.showQuickPick([ no, yes ], {
        canPickMany: false,
        ignoreFocusOut: false,
        title: "Are you sure you want to delete this note?"
    });
    if (areYouSure === null || areYouSure === undefined || areYouSure.length === 0 || areYouSure === no) return null;

    // Find the index of the note that was clicked on to add this new note, so that
    //      we can insert this note right after
    const removeIndex = this.notebook.findIndex(selected => selected.noteId === resource.noteId);
    if (removeIndex === -1) return null;
    this.notebook.splice(removeIndex, 1);
    await vscode.workspace.fs.delete(
        vscode.Uri.joinPath(this.notebookFolderPath, `${resource.noteId}.wtnote`)
    );
    this.refresh();
    return resource.noteId;
};

export async function editNote (this: Notebook, resource: Note | SubNote | AppearanceContainer) {
    
    let note: Note | undefined = undefined;
    switch (resource.kind) {
        case 'appearance': case 'appearanceContainer': case 'description':
            note = this.notebook.find(note => {
                return note.noteId === resource.noteId;
            });
        case 'note':
            note = resource as Note;
    }
    if (note === undefined) return;

    const noteFileName = `${note.noteId}.wtnote`
    const notePath = vscode.Uri.joinPath(this.notebookFolderPath, noteFileName);
    
    const document = await vscode.workspace.openTextDocument(notePath);
    return vscode.window.showTextDocument(document, {
        preview: false,
        viewColumn: await determineAuxViewColumn((uri) => this.getNote(uri)),
    }).then(() => {
        TabLabels.assignNamesForOpenTabs();
    });
}

export async function readNotebook (this: Notebook): Promise<Note[]> {
    const readPromises: PromiseLike<Note>[] = [];
    for (const [ fileName, type ] of await vscode.workspace.fs.readDirectory(this.notebookFolderPath)) {
        if (type !== vscode.FileType.File) {
            continue;
        }
        const uri = vscode.Uri.joinPath(this.notebookFolderPath, fileName);
        readPromises.push(vscode.workspace.fs.readFile(uri).then(readSingleNote));
    }
    return Promise.all(readPromises);
}

export async function readSingleNote (buffer: ArrayBufferLike) {
    const text = extension.decoder.decode(buffer);
    const serializedNote: SerializedNote = JSON.parse(text);
    const note: Note = {
        ...serializedNote,
        uri: vscode.Uri.joinPath(extension.globalWorkspace!.notebookFolder, `${serializedNote.noteId}.wtnote`)
    }
    return note;
}

export async function writeSingleNote (this: Notebook, note: Note): Promise<vscode.Uri> {
    const uri = note.uri;
    const serializedNote = serializeSingleNote(note);
    const jsonNote = JSON.stringify(serializedNote, undefined, 4);
    await vscode.workspace.fs.writeFile(uri, Buff.from(jsonNote));
    return uri;
}

export function serializeSingleNote (note: Note) {
    const tmp: Omit<Note, "uri"> & Partial<Pick<Note, "uri">> = {...note};
    delete tmp.uri;
    const serializedNote: SerializedNote = tmp;
    return serializedNote;
}