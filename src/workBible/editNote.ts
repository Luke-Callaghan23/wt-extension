import * as vscode from 'vscode';
import { AppearanceContainer, Note, SubNote, WorkBible } from './workBible';
import { TabLabels } from '../tabLabels/tabLabels';

export async function editNote (this: WorkBible, resource: Note | SubNote | AppearanceContainer) {
    
    let note: Note | undefined = undefined;
    switch (resource.kind) {
        case 'appearance': case 'appearanceContainer': case 'description':
            note = this.notes.find(note => {
                return note.noteId === resource.noteId;
            });
        case 'note':
            note = resource as Note;
    }
    if (note === undefined) return;

    const noteFileName = `${note.noteId}.wtnote`
    const notePath = vscode.Uri.joinPath(this.workBibleFolderPath, noteFileName);

    
    // Normally open the work notes doucument in the view column beside the current one
    let viewColumn = vscode.ViewColumn.Beside;

    // When we are currently editing a work notes document, however, open the new 
    //      work notes doc in the same view column
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const activeDocumentUri = activeEditor.document.uri;
        if (this.getNote(activeDocumentUri)) {
            viewColumn = vscode.ViewColumn.Active;
        }
    }
    
    const document = await vscode.workspace.openTextDocument(notePath);
    return vscode.window.showTextDocument(document, {
        preview: false,
        viewColumn: viewColumn,
    }).then(() => {
        TabLabels.assignNamesForOpenTabs();
    });
}

export function getNoteText (note: Note): string {
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