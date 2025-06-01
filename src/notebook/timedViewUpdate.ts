import * as vscode from 'vscode';
import { NotebookPanelNote, NoteMatch, NotebookPanel } from './notebookPanel';
import { compareFsPath, formatFsPathForCompare } from '../miscTools/help';
import { capitalize } from '../miscTools/help';

const decorationsOptions: vscode.DecorationRenderOptions = {
    color: new vscode.ThemeColor('textLink.foreground'),
    textDecoration: 'underline',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};
export const notebookDecorations = vscode.window.createTextEditorDecorationType(decorationsOptions);


export type TextMatchForNote = {
    start: number,
    end: number,
    tag: string,
    matchedNote: NotebookPanelNote
};

export function *getNoteMatchesInText (this: NotebookPanel, text: string): Generator<TextMatchForNote> {
    if (!this.titlesAndAliasesRegex) return;

    let match: RegExpExecArray | null;
    while ((match = this.titlesAndAliasesRegex.exec(text))) {
        const matchReal: RegExpExecArray = match;

        let matchedNote: NotebookPanelNote | undefined;
        let tag: string = match[0];
        const groups = matchReal.groups;
        if (groups) {
            try {

                // Get the note ids of each matched note
                const matchedNoteIds = Object.entries(groups)
                    .filter(([ noteId, match ]) => match)
                    .map(([ noteId, match ]) => noteId);

                // Get the note objects for each matched note
                const matchedNotebook = matchedNoteIds.map(matchedNoteId => {
                    const result = this.notebook.find(note => note.noteId === matchedNoteId);
                    if (result) {
                        matchedNote = result;
                        return result;
                    }
                    return [];
                }).flat();

                // Create a markdown string for the match
                const matchedMarkdown = matchedNotebook.map(note => {
                    return this.getMarkdownForNote(note);
                }).join('\n');
                tag = matchedMarkdown;
            }
            catch (err: any) {}
        }

        if (!matchedNote) return null;

        let start: number;
        let end: number;
        if (match.groups && matchedNote) {
            start = match.index + match[0].indexOf(match.groups[matchedNote.noteId]);
            end = start + match.groups[matchedNote.noteId].length;
        }
        else {
            start = match.index;
            const len = ((match.groups?.[matchedNote?.noteId || ''] || '').length + 1) || match[0].length;
            end = match.index + len;
    
            if (match.index + len !== text.length && text[match.index + len] !== '\n' && text[match.index + len] !== '\r') {
                end -= 1;
            }
            else {
                start += 1;
            }
        }

        yield { start, end, tag, matchedNote };
    }
}

export async function update (this: NotebookPanel, editor: vscode.TextEditor): Promise<void> {
    if (!this.titlesAndAliasesRegex) return;

    const matches: NoteMatch[] = [];
    const decorationLocations: vscode.DecorationOptions[] = [];

    // Used for comparing the uri of this document VS note uris.
    // If this document is a cell inside of a notebook, it will be assigned a unique value in 'fragment'
    //      but we do not want to use that when comparing against notes
    // So, copy the document uri and strip the fragment if it has one
    const compareUri = vscode.Uri.from({
        ...editor.document.uri,
        fragment: '',
    });

    for (const { start, end, matchedNote, tag } of this.getNoteMatchesInText(editor.document.getText())) {
        const startPos = editor.document.positionAt(start);
        const endPos = editor.document.positionAt(end);

        const range = new vscode.Range(startPos, endPos);
        if (matchedNote) {
            matches.push({
                range: range,
                note: matchedNote
            });

            // When the document that is being edited is a cell inside of a notebook, we do not want to add the decorations
            //      to our own note's aliases or title
            // Simply because there is just too much blue everywhere, and it is annoying
            if (!compareFsPath(matchedNote.uri, compareUri)) {
                const decorationOptions: vscode.DecorationOptions = { 
                    range: range, 
                    hoverMessage: new vscode.MarkdownString(tag)
                };
                decorationLocations.push(decorationOptions);
            }
        }
    }
    
    if (matches.length > 0) {
        this.matchedNotebook[formatFsPathForCompare(editor.document.uri)] = matches;
    }
    else {
        delete this.matchedNotebook[formatFsPathForCompare(editor.document.uri)];
    }

    editor.setDecorations(notebookDecorations, decorationLocations);
}

export async function disable (this: NotebookPanel): Promise<void> {
    throw new Error('Method not implemented.');
}