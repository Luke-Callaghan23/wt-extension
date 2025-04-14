import * as vscode from 'vscode';
import { NotebookPanelNote, NotebookPanel, BulletPoint, NoteSection } from './notebookPanel';
import { TabLabels } from '../tabLabels/tabLabels';
import { determineAuxViewColumn } from '../miscTools/help';
import { Buff } from '../Buffer/bufferSource';
import * as extension from './../extension';
import { SerializedNote } from './notebookApi/notebookSerializer';

export async function addNote (this: NotebookPanel, resource: NotebookPanelNote | undefined): Promise<string | null> {
    const noun = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: 'Tom Tomington',
        prompt: `Enter the name for the new note: `,
    });
    if (noun === undefined || noun === null || noun.length === 0) return null;

    const noteId = NotebookPanel.getNewNoteId();
    const notePath = vscode.Uri.joinPath(this.notebookFolderPath, `${noteId}.wtnote`);
    const insert: NotebookPanelNote = {
        title: noun,
        kind: 'note',
        noteId: noteId,
        uri: notePath,
        aliases: [],
        sections: [{
            kind: 'section',
            noteId: noteId,
            idx: 0,
            header: 'appearance',
            bullets: [],
        }, {
            kind: 'section',
            noteId: noteId,
            idx: 1,
            header: 'notes',
            bullets: [],
        }]
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
    this.serializer.writeSingleNote(insert).then(result => {
        if (result === null) return;
        vscode.workspace.openTextDocument(result).then(async document => {
            vscode.window.showTextDocument(document, {
                viewColumn: await determineAuxViewColumn((uri) => this.getNote(uri))
            });
        });
    })


    return insert.noteId;
}

export async function removeNote (this: NotebookPanel, resource: NotebookPanelNote): Promise<string | null> {
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

export async function editNote (this: NotebookPanel, resource: NotebookPanelNote | NoteSection | BulletPoint) {
    
    let note: NotebookPanelNote | undefined = undefined;
    if (resource.kind === 'note') {
        note = resource as NotebookPanelNote;
    }
    else {
        note = this.notebook.find(note => {
            return note.noteId === resource.noteId;
        });
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