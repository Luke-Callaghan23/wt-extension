import * as vscode from 'vscode';
import { Note, NoteMatch, WorldNotes } from './worldNotes';

const decorationsOptions: vscode.DecorationRenderOptions = {
    color: '#890cf7',
    textDecoration: 'underline',
    fontStyle: 'oblique',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};
export const decorations = vscode.window.createTextEditorDecorationType(decorationsOptions);

export async function update (this: WorldNotes, editor: vscode.TextEditor): Promise<void> {
    if (!this.nounsRegex) return;
    let match: RegExpExecArray | null;
    
    const decorationLocations: vscode.DecorationOptions[] = [];

    this.matchedNotes = undefined;
    const matches: NoteMatch[] = [];
    const text = editor.document.getText();
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

                    const descriptions = note.descriptions
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
        let end: number = match.index + match[0].length;
        if (match.index + match[0].length !== text.length) {
            end -= 1;
        }
        const startPos = editor.document.positionAt(start);
        const endPos = editor.document.positionAt(end);

        const range = new vscode.Range(startPos, endPos);
        if (matchedNote) {
            matches.push({
                range: range,
                note: matchedNote
            });
        }
        const decorationOptions: vscode.DecorationOptions = { 
            range: range, 
            hoverMessage: new vscode.MarkdownString(tag)
        };
        decorationLocations.push(decorationOptions);
    }
    if (matches.length > 0) {
        this.matchedNotes = {
            docUri: editor.document.uri,
            matches: matches
        };
    }
    editor.setDecorations(decorations, decorationLocations);
}

export async function disable (this: WorldNotes): Promise<void> {
    throw new Error('Method not implemented.');
}