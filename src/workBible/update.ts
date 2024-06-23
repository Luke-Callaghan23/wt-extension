import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { SubNote, Note, WorkBible, AppearanceContainer } from "./workBible";
import { determineAuxViewColumn } from '../help';


export async function addNote (this: WorkBible, resource: Note | undefined): Promise<string | null> {
    const noun = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: 'Tom Tomington',
        prompt: `Enter the name for the new note: `,
    });
    if (noun === undefined || noun === null || noun.length === 0) return null;

    const noteId = WorkBible.getNewNoteId();
    const notePath = vscode.Uri.joinPath(this.workBibleFolderPath, `${noteId}.wtnote`);
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
        idx = this.notes.findIndex(selected => selected.noteId === resource.noteId);
        if (idx === -1) idx = this.notes.length;
    }
    else {
        // If the plus button in the header was hit, then resource === undefined
        // Insert the new note at the end of the note list
        idx = this.notes.length-1;
    }

    // Push the note in the selected index
    this.notes = [
        ...this.notes.slice(0, idx+1),
        insert,
        ...this.notes.slice(idx+1)
    ];
    this.writeNotes();
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

export async function removeNote (this: WorkBible, resource: Note): Promise<string | null> {
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
    const removeIndex = this.notes.findIndex(selected => selected.noteId === resource.noteId);
    if (removeIndex === -1) return null;
    this.notes.splice(removeIndex, 1);
    this.writeNotes();
    this.refresh();
    return resource.noteId;
}

