import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import { Note, Notebook } from '../notebook';
import { readSingleNote, serializeSingleNote } from '../updateNoteContents';

const nounTitleIndex = 0;
const nounIndex = 1;
const aliasesTitleIndex = 2;
const aliasesIndex = 3;
const appearanceTitleIndex = 4;
const appearanceIndex = 5;
const descriptionTitleIndex = 6;
const descriptionIndex = 7;

export type SerializedNote = Omit<Note, 'uri'>;
export class WTNotebookSerializer implements vscode.NotebookSerializer {
    // constructor

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private notebook: Notebook,
    ) {

    }

    async deserializeNotebook(content: Uint8Array): Promise<vscode.NotebookData> {
        const note = await readSingleNote(content);
        // Parse your notebook content here

        const nbd: vscode.NotebookCellData[] = [];

        nbd[nounTitleIndex] = {
            kind: vscode.NotebookCellKind.Markup,
            languageId: 'markdown',
            value: "# Enter Noun Here:",
            metadata: { "noteId": note.noteId },
        };
        nbd[nounIndex] = {
            kind: vscode.NotebookCellKind.Code,
            languageId: 'wtnote',
            value: note.noun,
            metadata: { "noteId": note.noteId },
        };
        nbd[aliasesTitleIndex] = {
            kind: vscode.NotebookCellKind.Markup,
            languageId: 'markdown',
            value: "# Enter Aliases Here:",
            metadata: { "noteId": note.noteId },
        };
        nbd[aliasesIndex] = {
            kind: vscode.NotebookCellKind.Code,
            languageId: 'wtnote',
            value: note.aliases.join(" ; "),
            metadata: { "noteId": note.noteId },
        };
        nbd[appearanceTitleIndex] = {
            kind: vscode.NotebookCellKind.Markup,
            languageId: 'markdown',
            value: "# Enter Appearance Here:",
            metadata: { "noteId": note.noteId },
        };
        nbd[appearanceIndex] = {
            kind: vscode.NotebookCellKind.Code,
            languageId: 'wtnote',
            value: note.appearance.join("\n\n"),
            metadata: { "noteId": note.noteId },
        };
        nbd[descriptionTitleIndex] = {
            kind: vscode.NotebookCellKind.Markup,
            languageId: 'markdown',
            value: "# Enter Description Here:",
            metadata: { "noteId": note.noteId },
        };
        nbd[descriptionIndex] = {
            kind: vscode.NotebookCellKind.Code,
            languageId: 'wtnote',
            value: note.description.join("\n\n"),
            metadata: { "noteId": note.noteId },
        };


        const nd = new vscode.NotebookData(nbd);
        nd.metadata = {
            "noteId": note.noteId,
        }
        return nd;
    }   

    async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
        // Convert your notebook data back to bytes

        const metadata: { 
            "noteId": string
        } = data.metadata! as any;

        const uri = vscode.Uri.joinPath(this.workspace.notebookFolder, `${metadata.noteId}.wtnote`);
        const note = this.notebook.getNote(uri);
        if (!note) throw 'unreachable';
        const serialized = serializeSingleNote(note);
        const json = JSON.stringify(serialized, undefined, 4);

        return new TextEncoder().encode(json);
    }
}