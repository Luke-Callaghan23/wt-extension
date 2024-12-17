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
        
        const start = selection.start;
        const startOff = document.offsetAt(start);
        const end = selection.end;
        const endOff = document.offsetAt(end);

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

        // Iterate forward and backward in the current paragraph to expand

        const beginningOfParagraph = document.offsetAt(new vscode.Position(start.line, 0));
        const endOfParagraph = document.offsetAt(new vscode.Position(start.line + 1, 0)) - 1;

        let stopAtForward: number | null = null;
        for (let iterateForward = 0; iterateForward >= beginningOfParagraph; iterateForward--) {
            const char = docText[iterateForward];
            if (punctuationStopsReg.test(char) || fragmentStopReg.test(char) || newlineReg.test(char)) {
                stopAtForward = iterateForward;
                break;
            } 
        }
        if (stopAtForward === null) stopAtForward = beginningOfParagraph;

        let stopAtBackward: number | null = null;
        for (let iterateBackwards = 0; iterateBackwards <= endOfParagraph; iterateBackwards++) {
            const char = docText[iterateBackwards];
            if (punctuationStopsReg.test(char) || fragmentStopReg.test(char) || newlineReg.test(char)) {
                stopAtForward = stopAtBackward;
                break;
            }
        }
        if (stopAtBackward === null) stopAtBackward = endOfParagraph;

        return new vscode.Selection(
            document.positionAt(stopAtForward!),
            document.positionAt(stopAtBackward!)
        );
    });
    editor.selections = newSelections;
}


/*

Example sentence

Here is a sentence who -- happens so -- have, by chance, a ton of -- *clever* -- asides, and twists, and, of course, some turns -- as well.  Here is a ^bold^ sentence, with no shortage of _underlined words_; no doubt, you -- dear reader -- will appreciate the ~scratch that~, never mind.  I think most paragraphs, of course, need to have third sentences in them for them to make sense.


*/