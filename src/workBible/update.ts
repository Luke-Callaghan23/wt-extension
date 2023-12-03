import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { SubNote, Note, WorkBible, AppearanceContainer } from "./workBible";


export async function addAlias (this: WorkBible, resource: Note): Promise<void> {
    const alias = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: 'The boy who lived',
        prompt: `Enter a new alias for ${resource.noun}: `,
    });
    if (alias === undefined || alias === null || alias.length === 0) return;

    resource.aliases.push(alias);
    this.writeNotes(this.workBibleFolderPath);
    this.refresh();
}

export async function removeAlias (this: WorkBible, resource: Note): Promise<void> {
    const remove = await vscode.window.showQuickPick(resource.aliases, {
        canPickMany: false,
        ignoreFocusOut: false,
        title: "Remove which alias?",
    });
    if (remove === undefined || remove === null || remove.length === 0) return;

    const removeIndex = resource.aliases.findIndex(alias => remove === alias);
    if (removeIndex === -1) return;
    resource.aliases.splice(removeIndex, 1);
    this.writeNotes(this.workBibleFolderPath);
    this.refresh();
}

export async function addNote (this: WorkBible, resource: Note | undefined): Promise<void> {
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

    const appearanceTmp = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: `Blonde hair`,
        prompt: `Enter a short appearance for ${noun}: `,
    });
    if (appearanceTmp === undefined || appearanceTmp === null) return;

    const appearance = appearanceTmp.length === 0 
        ? []
        : [ appearanceTmp ]

    const insert: Note = {
        noun: noun,
        descriptions: [ description ],
        appearance: appearance,
        aliases: [],
        kind: 'note',
        noteId: WorkBible.getNewNoteId(),
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
    this.writeNotes(this.workBibleFolderPath);
    this.refresh();
}

export async function removeNote (this: WorkBible, resource: Note): Promise<void> {
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
    this.writeNotes(this.workBibleFolderPath);
    this.refresh();
}

export async function addSubNote (this: WorkBible, resource: SubNote): Promise<void> {
    const note = this.notes.find(note => note.noteId === resource.noteId);
    if (note === undefined || note === null) return;

    const [ placeHolder, prompt ] = resource.kind === 'description'
        ? [
            `${note.noun} is a Dark Lord who kills people and whatnot`,
            `Enter a short description for ${note.noun}: `
        ]
        : [
            `Blonde Hair`,
            `Enter a short appearance description for ${note.noun}: `
        ]

    const subNote = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: placeHolder,
        prompt: prompt,
    });
    if (subNote === undefined || subNote === null || subNote.length === 0) return;

    const idx = resource.idx;
    note[resource.kind] = [
        ...note[resource.kind].slice(0, idx+1),
        subNote,
        ...note[resource.kind].slice(idx+1)
    ];
    this.writeNotes(this.workBibleFolderPath);
    this.refresh();
}

export async function removeSubNote (this: WorkBible, resource: SubNote): Promise<void> {
    const ask = 
        (resource.kind === 'appearance' && !this.dontAskDeleteAppearance) ||
        (resource.kind === 'description' && !this.dontAskDeleteDescription);
    if (ask) {
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
            if (resource.kind === 'appearance') {
                this.dontAskDeleteAppearance = true;
                this.context.globalState.update('wt.workBible.dontAskDeleteAppearance', true);
            }
            else if (resource.kind === 'description') {
                this.dontAskDeleteDescription = true;
                this.context.globalState.update('wt.workBible.dontAskDeleteDescription', true);
            }
        }
    }

    const note = this.notes.find(note => note.noteId === resource.noteId);
    if (note === undefined || note === null) return;

    if (resource.kind === 'appearance') {
        note.appearance.splice(resource.idx, 1);
    }
    else if (resource.kind === 'description') {
        note.descriptions.splice(resource.idx, 1);
    }
    this.writeNotes(this.workBibleFolderPath);
    this.refresh();
}

export async function addAppearance (this: WorkBible, resource: AppearanceContainer): Promise<void> {
    const note = this.notes.find(note => note.noteId === resource.noteId);
    if (note === undefined || note === null) return;

    const placeHolder = `Blonde Hair`;
    const prompt = `Enter a short appearance description for ${note.noun}: `;
    const appearance = await vscode.window.showInputBox({
        ignoreFocusOut: false,
        placeHolder: placeHolder,
        prompt: prompt,
    });
    if (appearance === undefined || appearance === null || appearance.length === 0) return;

    note.appearance.push(appearance);
    this.writeNotes(this.workBibleFolderPath);
    this.refresh();
}
