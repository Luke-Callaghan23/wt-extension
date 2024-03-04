import * as vscode from 'vscode';
import { highlightFragment, highlightParagraph, highlightSentence, highlightWord } from './highlights';
import { surroundSelectionWith } from './surroundSelection';
import { punctuationStopsReg } from './jumps';


function rollbackIfCommented () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const text = editor.document.getText();
    const selections = [...editor.selections];
    for (let selectionIndex = 0; selectionIndex < selections.length; selectionIndex++) {
        const selection = selections[selectionIndex];
        const start = selection.start;
        const anchor = selection.end;
        
        const startOff = editor.document.offsetAt(start);
        const endOff = editor.document.offsetAt(anchor);

        const startChar = text[startOff];
        const endChar = text[endOff];
        if (startChar === '[' && endChar === ']') {
            const newStart = editor.document.positionAt(startOff + 1);
            const newEnd = editor.document.positionAt(endOff - 1);
            const newSelection = new vscode.Selection(newStart, newEnd);
            selections[selectionIndex] = newSelection;
        }
    }
    editor.selections = selections;
}

export async function commentSentence () {
    // Add the stops for '[' and ']' for sentence jumps
    const puncSourceStr = punctuationStopsReg.source;
    const newSrc = "[\\[\\]" + puncSourceStr.substring(1);
    const sentenceJump = new RegExp(newSrc);

    rollbackIfCommented();

    await highlightSentence(sentenceJump);
    return surroundSelectionWith('[', ']');
}

export async function commentParagraph () {
    await highlightParagraph();
    return surroundSelectionWith('[', ']');
}

export async function commentFragment () {
    await highlightFragment();
    return surroundSelectionWith('[', ']');
}

