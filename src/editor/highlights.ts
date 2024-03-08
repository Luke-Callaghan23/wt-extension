import * as vscode from 'vscode';
import { defaultJumpFragmentOptions, fragmentStopReg, jumpParagraph, jumpParagraphSingleSelection, jumpSentence, jumpSentenceSingleSelection, jumpWord, jumpWordSingleSelection, punctuationStopsReg } from './jumps';

export async function highlightWord () {
    await jumpWord('backward', false);                           // Jump backward
    await jumpWord('forward', true);                           // Jump forward holding shift
}

export async function highlightSentence (sentenceJumpReg: RegExp = punctuationStopsReg) {
    await jumpSentence('backward', false, {
        punctuationStops: sentenceJumpReg
    });                      // Jump backward
    await jumpSentence('forward', true, {
        punctuationStops: sentenceJumpReg
    });                      // Jump forward holding shift
}

export async function highlightParagraph () {
    await jumpParagraph('backward', false);                      // Jump backward
    await jumpParagraph('forward', true);                      // Jump forward holding shift
}

export async function highlightFragment (fragmentJumpReg: RegExp = fragmentStopReg) {
    await jumpSentence('backward', false, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    });                 
    await jumpSentence('forward', true, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    });                 
}



export function highlightWordSingleSelection (
    selection: vscode.Selection, 
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const initial = jumpWordSingleSelection('backward', false, selection, document, docText);
    return jumpWordSingleSelection('forward', true, initial, document, docText);
}

export function highlightSentenceSingleSelection (
    sentenceJumpReg: RegExp = punctuationStopsReg, 
    selection: vscode.Selection,
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const initial = jumpSentenceSingleSelection('backward', false, {
        punctuationStops: sentenceJumpReg
    }, selection, document, docText);
    return jumpSentenceSingleSelection('forward', true, {
        punctuationStops: sentenceJumpReg
    }, initial, document, docText);
}

export function highlightParagraphSingleSelection (
    selection: vscode.Selection, 
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const initial = jumpParagraphSingleSelection('backward', false, selection, document, docText);
    return jumpParagraphSingleSelection('forward', true, initial, document, docText);
}

export function highlightFragmentSingleSelection (
    fragmentJumpReg: RegExp = fragmentStopReg, 
    selection: vscode.Selection, 
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const initial = jumpSentenceSingleSelection('backward', false, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    }, selection, document, docText);
    return jumpSentenceSingleSelection('forward', true, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    }, initial, document, docText);
}

const newlineReg = /\n|\r\n/;
export async function highlightExpand () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const docText = document.getText();

    const newSelections = editor.selections.map(selection => {
        const selectionText = document.getText(new vscode.Selection(selection.anchor, selection.active));
        
        const anchOff = document.offsetAt(selection.anchor);
        const actOff = document.offsetAt(selection.active);

        const startOff = Math.min(anchOff, actOff);
        const endOff = Math.max(anchOff, actOff);

        const prevChar = docText[startOff - 1];
        const nextChar = docText[endOff + 1];

        // First check if it includes a space
        if (
            (selectionText.length === 0 || /\s/.exec(selectionText) === null)
            && (prevChar !== ' ' || prevChar === undefined)
            && (nextChar !== ' ' || nextChar === undefined)
        ) {
            return highlightWordSingleSelection(selection, document, docText);
        }

        // Check if it includes any of the fragment stops
        if (fragmentStopReg.exec(selectionText) === null) {
            // Check if it includes any of the sentence stops
            if (punctuationStopsReg.exec(selectionText) !== null) {
                if (newlineReg.exec(nextChar) === null) {
                    return highlightParagraphSingleSelection(selection, document, docText);
                }
                return new vscode.Selection(
                    document.positionAt(0),
                    document.positionAt(100000000000000)
                );
            }
            return highlightFragmentSingleSelection(undefined, selection, document, docText);
        }

        // Check if it includes any of the sentence stops
        if (punctuationStopsReg.exec(selectionText) === null) {
            return highlightSentenceSingleSelection(undefined, selection, document, docText);
        }

        // Check if it includes any of the paragraph stops
        if (
            (newlineReg.exec(selectionText) === null)
            && (newlineReg.exec(prevChar) === null)
            && (newlineReg.exec(nextChar) === null)
        ) {
            return highlightParagraphSingleSelection(selection, document, docText);
        }

        return new vscode.Selection(
            document.positionAt(0),
            document.positionAt(100000000000000)
        );
    });
    editor.selections = newSelections;
}