import * as vscode from 'vscode';
import { Note, NoteMatch, WorkBible } from './workBible';
import { compareFsPath, formatFsPathForCompare } from '../miscTools/help';

const decorationsOptions: vscode.DecorationRenderOptions = {
    color: '#006eff',
    fontStyle: 'oblique',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};
export const decorations = vscode.window.createTextEditorDecorationType(decorationsOptions);

export async function update (this: WorkBible, editor: vscode.TextEditor): Promise<void> {
    if (!this.nounsRegex) return;
    let match: RegExpExecArray | null;

    
    const decorationLocations: vscode.DecorationOptions[] = [];

    const matches: NoteMatch[] = [];
    let text = editor.document.getText();

    while ((match = this.nounsRegex.exec(text))) {
        const matchReal: RegExpExecArray = match;

        let matchedNote: Note | undefined;
        let tag: string = match[0];
        const groups = matchReal.groups;
        if (groups) {
            try {

                // Get the note ids of each matched note
                const matchedNoteIds = Object.entries(groups)
                    .filter(([ noteId, match ]) => match)
                    .map(([ noteId, match ]) => noteId);

                // Get the note objects for each matched note
                const matchedNotes = matchedNoteIds.map(matchedNoteId => {
                    const result = this.notes.find(note => note.noteId === matchedNoteId);
                    if (result) {
                        matchedNote = result;
                        return result;
                    }
                    return [];
                }).flat();

                // Create a markdown string for the match
                const matchedMarkdown = matchedNotes.map(note => {
                    const aliasesString = note.aliases.join(', ');
                    const title = `## ${note.noun}`;
                    const subtitle = aliasesString.length !== 0
                        ? `#### (*${aliasesString}*)\n`
                        : '';

                    const descriptions = note.description
                        .map(desc => `- ${desc}`)
                        .join('\n');

                    return `${title}\n${subtitle}\n${descriptions}`;
                }).join('\n');
                tag = matchedMarkdown;
            }
            catch (err: any) {}
        }



        let start: number = match.index;
        if (match.index !== 0) {
            start += 1;
        }

        const len = ((match.groups?.[matchedNote?.noteId || ''] || '').length + 1) || match[0].length;
        let end: number = match.index + len;
        if (match.index + len !== text.length) {
            // end -= 1;
        }
        const startPos = editor.document.positionAt(start);
        const endPos = editor.document.positionAt(end);

        const range = new vscode.Range(startPos, endPos);
        if (matchedNote) {
            matches.push({
                range: range,
                note: matchedNote
            });

            // Do not add stylization to the note document of the note's note thingy
            // Too much blue everywhere
            // Still want stylization for other note's note thingies, just not your own
            if (!compareFsPath(matchedNote.uri, editor.document.uri)) {
                const decorationOptions: vscode.DecorationOptions = { 
                    range: range, 
                    hoverMessage: new vscode.MarkdownString(tag)
                };
                decorationLocations.push(decorationOptions);
            }
        }
    }
    if (matches.length > 0) {
        this.matchedNotes[formatFsPathForCompare(editor.document.uri)] = matches;
    }
    else {
        delete this.matchedNotes[formatFsPathForCompare(editor.document.uri)];
    }

    editor.setDecorations(decorations, decorationLocations);
}

export async function disable (this: WorkBible): Promise<void> {
    throw new Error('Method not implemented.');
}