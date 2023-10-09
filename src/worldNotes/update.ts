import * as vscode from 'vscode';
import * as console from './../vsconsole';
import { Description, Note, WorldNotes } from "./worldNotes";


export async function addAlias (this: WorldNotes, resource: Note): Promise<void> {
    const alias = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: 'The boy who lived',
        prompt: `Enter a new alias for ${resource.noun}: `,
    });
    if (alias === undefined || alias === null || alias.length === 0) return;

    resource.aliases.push(alias);
    this.writeNotes(this.worldNotesPath);
    this.refresh();
}

export async function removeAlias (this: WorldNotes, resource: Note): Promise<void> {
    const remove = await vscode.window.showQuickPick(resource.aliases, {
        canPickMany: false,
        ignoreFocusOut: false,
        title: "Remove which alias?",
    });
    if (remove === undefined || remove === null || remove.length === 0) return;

    const removeIndex = resource.aliases.findIndex(alias => remove === alias);
    if (removeIndex === -1) return;
    resource.aliases.splice(removeIndex, 1);
    this.writeNotes(this.worldNotesPath);
    this.refresh();
}

export async function addNote (this: WorldNotes, resource: Note | undefined): Promise<void> {
    const noun = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: 'Tom Tomington',
        prompt: `Enter the name for the new note: `,
    });
    if (noun === undefined || noun === null || noun.length === 0) return;

    const description = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: `${noun} is a Dark Lord who kills people and whatnot`,
        prompt: `Enter a short description for ${noun}: `,
    });
    if (description === undefined || description === null || description.length === 0) return;

    const insert: Note = {
        noun: noun,
        descriptions: [ description ],
        aliases: [],
        kind: 'note',
        noteId: WorldNotes.getNewNoteId(),
    };

    let idx; 
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
    this.writeNotes(this.worldNotesPath);
    this.refresh();
}

export async function removeNote (this: WorldNotes, resource: Note): Promise<void> {
    if (!this.dontAskDeleteNote) {
        const no = 'No';
        const yes = 'Yes';
        const dontAsk = "Yes, don't ask again";
        const areYouSure = await vscode.window.showQuickPick([ no, yes, dontAsk ], {
            canPickMany: false,
            ignoreFocusOut: false,
            title: "Are you sure you want to delete this note?"
        });
        if (areYouSure === null || areYouSure === undefined || areYouSure.length === 0 || areYouSure === no) return;
        
        if (areYouSure === dontAsk) {
            this.dontAskDeleteNote = true;
            this.context.globalState.update('wt.worldNotes.dontAskDeleteNote', true);
        }
    }

    // Find the index of the note that was clicked on to add this new note, so that
    //      we can insert this note right after
    const removeIndex = this.notes.findIndex(selected => selected.noteId === resource.noteId);
    if (removeIndex === -1) return;
    this.notes.splice(removeIndex, 1);
    this.writeNotes(this.worldNotesPath);
    this.refresh();
}

export async function addDescription (this: WorldNotes, resource: Description): Promise<void> {
    const note = this.notes.find(note => note.noteId === resource.noteId);
    if (note === undefined || note === null) return;

    const description = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: `${note.noun} is a Dark Lord who kills people and whatnot`,
        prompt: `Enter a short description for ${note.noun}: `,
    });
    if (description === undefined || description === null || description.length === 0) return;

    const idx = resource.idx;
    note.descriptions = [
        ...note.descriptions.slice(0, idx+1),
        description,
        ...note.descriptions.slice(idx+1)
    ];
    this.writeNotes(this.worldNotesPath);
    this.refresh();
}

export async function removeDescription (this: WorldNotes, resource: Description): Promise<void> {
    if (!this.dontAskDeleteDescription) {
        const no = 'No';
        const yes = 'Yes';
        const dontAsk = "Yes, don't ask again";
        const areYouSure = await vscode.window.showQuickPick([ no, yes, dontAsk ], {
            canPickMany: false,
            ignoreFocusOut: false,
            title: "Are you sure you want to delete this description?"
        });
        if (areYouSure === null || areYouSure === undefined || areYouSure.length === 0 || areYouSure === no) return;
        
        if (areYouSure === dontAsk) {
            this.dontAskDeleteDescription = true;
            this.context.globalState.update('wt.worldDescriptions.dontAskDeleteDescription', true);
        }
    }

    const note = this.notes.find(note => note.noteId === resource.noteId);
    if (note === undefined || note === null) return;
    note.descriptions.splice(resource.idx, 1);
    this.writeNotes(this.worldNotesPath);
    this.refresh();
}
