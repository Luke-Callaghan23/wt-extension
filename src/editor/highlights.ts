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
function expandSingleHighlight (
    selection: vscode.Selection, 
    editor: vscode.TextEditor, 
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const selectionText = document.getText(new vscode.Selection(selection.anchor, selection.active));
        
    const start = selection.start;
    const startOff = document.offsetAt(start);
    const end = selection.end;
    const endOff = document.offsetAt(end);

    const prevChar = docText[startOff - 1];
    const nextChar = docText[endOff + 1];

    if (selectionText.length === docText.length) {
        return selection;
    }

    // First check if it includes a space
    if (
        selectionText.length === 0 ||
        (/\s/.exec(selectionText) === null
        && (prevChar !== ' ' || prevChar === undefined)
        && (nextChar !== ' ' || nextChar === undefined))
    ) {
        return highlightWordSingleSelection(selection, document, docText);
    }

    // Iterate forward and backward in the current paragraph to expand

    const beginningOfParagraph = document.offsetAt(new vscode.Position(start.line, 0));
    let endOfParagraph = document.offsetAt(new vscode.Position(end.line + 1, 0));
    if (endOfParagraph !== docText.length) {
        endOfParagraph -= document.eol;
    }

    if (beginningOfParagraph === startOff && endOfParagraph === endOff) {
        // Skip over whitespace forwards and backwards to continue onto the next paragraph

        let forward = startOff - 1;
        let backward = endOff + 1;
        for (; /\s/.test(docText[forward]) && forward >= 0; forward--) {}
        for (; /\s/.test(docText[backward]) && backward < docText.length; backward++) {}

        return expandSingleHighlight(new vscode.Selection(
            document.positionAt(forward),
            document.positionAt(backward)
        ), editor, document, docText);
    }

    let stopAtForward: number | null = null;
    for (let iterateForward = startOff - 1; iterateForward >= beginningOfParagraph; iterateForward--) {
        let found = false;

        // If we ever do hit a stopping character, then keep iterating over the stopping characters until we reach the end
        let char = docText[iterateForward];
        while ((punctuationStopsReg.test(char) || fragmentStopReg.test(char) || newlineReg.test(char)) && iterateForward >= 0) {
            found = true;
            iterateForward--;
            char = docText[iterateForward];
        } 

        if (found) {
            stopAtForward = iterateForward;
            break;
        }
    }

    // Same as above, but in the other direction
    let stopAtBackward: number | null = null;
    for (let iterateBackwards = endOff + 1; iterateBackwards <= endOfParagraph; iterateBackwards++) {
        
        let found = false;
        let char = docText[iterateBackwards];
        while ((punctuationStopsReg.test(char) || fragmentStopReg.test(char) || newlineReg.test(char)) && iterateBackwards <= endOfParagraph) {
            found = true;
            iterateBackwards++;
            char = docText[iterateBackwards];
        }

        if (found) {
            stopAtBackward = iterateBackwards;
            break;
        }
    }

    return new vscode.Selection(
        document.positionAt(stopAtForward || beginningOfParagraph),
        document.positionAt(stopAtBackward || endOfParagraph)
    );
}


export async function highlightExpand () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const docText = document.getText();

    const newSelections = editor.selections.map(selection => {
        return expandSingleHighlight(selection, editor, document, docText);
    });
    editor.selections = newSelections;
}


/*

Example sentence

Here is a sentence who -- happens so -- have, by chance, a ton of -- *clever* -- asides, and twists, and, of course, some turns -- as well.  Here is a ^bold^ sentence, with no shortage of _underlined words_; no doubt, you -- dear reader -- will appreciate the ~scratch that~, never mind.  I think most paragraphs, of course, need to have third sentences in them for them to make sense.


*/