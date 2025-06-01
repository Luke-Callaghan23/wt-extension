import * as vscode from 'vscode';
import { defaultJumpFragmentOptions, fragmentStopReg, jumpParagraph, jumpParagraphSingleSelection, jumpSentence, jumpSentenceSingleSelection, jumpWord, jumpWordSingleSelection, punctuationStopsReg } from './jumps';

export async function highlightWord () {
    await jumpWord('right', false);                           // Jump right
    await jumpWord('left', true);                           // Jump left holding shift
}

export async function highlightSentence (sentenceJumpReg: RegExp = punctuationStopsReg) {
    await jumpSentence('right', false, {
        punctuationStops: sentenceJumpReg
    });                      // Jump right
    await jumpSentence('left', true, {
        punctuationStops: sentenceJumpReg
    });                      // Jump left holding shift
}

export async function highlightParagraph () {
    await jumpParagraph('right', false);                      // Jump right
    await jumpParagraph('left', true);                      // Jump left holding shift
}

export async function highlightFragment (fragmentJumpReg: RegExp = fragmentStopReg) {
    await jumpSentence('right', false, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    });                 
    await jumpSentence('left', true, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    });                 
}



export function highlightWordSingleSelection (
    selection: vscode.Selection, 
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const initial = jumpWordSingleSelection('right', false, selection, document, docText);
    return jumpWordSingleSelection('left', true, initial, document, docText);
}

export function highlightSentenceSingleSelection (
    sentenceJumpReg: RegExp = punctuationStopsReg, 
    selection: vscode.Selection,
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const initial = jumpSentenceSingleSelection('right', false, {
        punctuationStops: sentenceJumpReg
    }, selection, document, docText);
    return jumpSentenceSingleSelection('left', true, {
        punctuationStops: sentenceJumpReg
    }, initial, document, docText);
}

export function highlightParagraphSingleSelection (
    selection: vscode.Selection, 
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const initial = jumpParagraphSingleSelection('right', false, selection, document, docText);
    return jumpParagraphSingleSelection('left', true, initial, document, docText);
}

export function highlightFragmentSingleSelection (
    fragmentJumpReg: RegExp = fragmentStopReg, 
    selection: vscode.Selection, 
    document: vscode.TextDocument, 
    docText: string
): vscode.Selection {
    const initial = jumpSentenceSingleSelection('right', false, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    }, selection, document, docText);
    return jumpSentenceSingleSelection('left', true, { 
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

    // Iterate left and right in the current paragraph to expand

    const beginningOfParagraph = document.offsetAt(new vscode.Position(start.line, 0));
    let endOfParagraph = document.offsetAt(new vscode.Position(end.line + 1, 0));
    if (endOfParagraph !== docText.length) {
        endOfParagraph -= document.eol;
    }

    if (beginningOfParagraph === startOff && endOfParagraph === endOff) {
        // Skip over whitespace lefts and rights to continue onto the next paragraph

        let left = startOff - 1;
        let right = endOff + 1;
        for (; /\s/.test(docText[left]) && left >= 0; left--) {}
        for (; /\s/.test(docText[right]) && right < docText.length; right++) {}

        return expandSingleHighlight(new vscode.Selection(
            document.positionAt(left),
            document.positionAt(right)
        ), editor, document, docText);
    }

    let stopAtLeft: number | null = null;
    for (let iterateLeft = startOff - 1; iterateLeft >= beginningOfParagraph; iterateLeft--) {
        let found = false;

        // If we ever do hit a stopping character, then keep iterating over the stopping characters until we reach the end
        let char = docText[iterateLeft];
        while ((punctuationStopsReg.test(char) || fragmentStopReg.test(char) || newlineReg.test(char)) && iterateLeft >= 0) {
            found = true;
            iterateLeft--;
            char = docText[iterateLeft];
        } 

        if (found) {
            stopAtLeft = iterateLeft;
            break;
        }
    }

    // Same as above, but in the other direction
    let stopAtRight: number | null = null;
    for (let iterateRights = endOff + 1; iterateRights <= endOfParagraph; iterateRights++) {
        
        let found = false;
        let char = docText[iterateRights];
        while ((punctuationStopsReg.test(char) || fragmentStopReg.test(char) || newlineReg.test(char)) && iterateRights <= endOfParagraph) {
            found = true;
            iterateRights++;
            char = docText[iterateRights];
        }

        if (found) {
            stopAtRight = iterateRights;
            break;
        }
    }

    return new vscode.Selection(
        document.positionAt(stopAtLeft || beginningOfParagraph),
        document.positionAt(stopAtRight || endOfParagraph)
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