import * as vscode from 'vscode';
import { NotebookPanelNote, NoteMatch, NotebookPanel } from './notebookPanel';
import { compareFsPath, formatFsPathForCompare } from '../miscTools/help';
import { capitalize } from '../miscTools/help';

const decorationsOptions: vscode.DecorationRenderOptions = {
    color: '#006eff',
    textDecoration: 'underline',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};
export const notebookDecorations = vscode.window.createTextEditorDecorationType(decorationsOptions);


export type TextMatchForNote = {
    start: number,
    end: number,
    tag: string,
    matchedNote: NotebookPanelNote | undefined
};

export function *getNoteMatchesInText (this: NotebookPanel, text: string): Generator<TextMatchForNote> {
    if (!this.nounsRegex) return;

    let match: RegExpExecArray | null;
    while ((match = this.nounsRegex.exec(text))) {
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
                    const aliasesString = note.aliases.join(', ');
                    const title = `## ${note.title}`;
                    const subtitle = aliasesString.length !== 0
                        ? `#### (*${aliasesString}*)\n`
                        : '';

                    const descriptions = note.sections.map(
                        section => `- ${capitalize(section.header)}\n` + (
                            section.bullets.map(
                                bullet => `  - ${bullet.text}`
                            ).join('\n')
                        )
                    ).join('\n');

                    return `${title}\n${subtitle}\n${descriptions}`;
                }).join('\n');
                tag = matchedMarkdown;
            }
            catch (err: any) {}
        }


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
    if (!this.nounsRegex) return;

    const matches: NoteMatch[] = [];
    const decorationLocations: vscode.DecorationOptions[] = [];

    for (const { start, end, matchedNote, tag } of this.getNoteMatchesInText(editor.document.getText())) {
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