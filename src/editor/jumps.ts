import * as vscode from 'vscode';


export type JumpType = 'forward' | 'backward'

export async function jumpWord (jt: JumpType, shiftHeld?: boolean): Promise<vscode.Selection | null> {
    const direction = jt === 'forward' ? -1 : 1;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const newSelections: vscode.Selection[] = [];
    for (const editorSelection of editor.selections) {
    
        const document = editor.document;
        if (!document) return null;
    
        const docText = document.getText();
        
    
        // Get initial offset of the cursor
        const start: vscode.Position = editorSelection.active;
        let offset = document.offsetAt(start);
        if (jt === 'forward') {
            // If going forward, the character we're inspecting is actually the one behind the cursor
            offset -= 1;
        }
        
        const stopRegex = /[\.\?,"'-\(\)\[\]\{\}/\\]/;
        
        // Move away from space characters
        let char = docText[offset];
        while (char && char === ' ') {
            offset += direction;
            if (offset === -1) {
                break;
            }
            char = docText[offset];
        }
        
        if (char && /\s/.test(char)) {
            // If the character is at whitespace, after moving away from spaces, then just move over all the whitespace
            //      as well
            while (char && /\s/.test(char)) {
                offset += direction;
                if (offset === -1) {
                    break;
                }
                char = docText[offset];
            }
        }
        else if (stopRegex.test(char)) {
            // If the cursor is initially at a stop character, then go until we find a non-stop character
            while (char && stopRegex.test(char)) {
                offset += direction;
                if (offset === -1) {
                    break;
                }
                char = docText[offset];
            }
        }
        else {
            const stopRegex = /[\s\.\?,"'-\(\)\[\]\{\}/\\]/;
            // If the cursor is at a non-stop character, then go until we find a stop character
            // (Also allow the character apostrophe character to be jumped -- as we don't want to stutter on the word 'don't')
            while (char && (char === "'" || !stopRegex.test(char))) {
                offset += direction;
                if (offset === -1) {
                    break;
                }
                char = docText[offset];
            }
        }
        
        if (jt === 'forward') {
            // Since we reached the stop character, back off one step (if going forward)
            offset -= direction;
        }
        
        // Set the new selection of the editor
        const position = document.positionAt(offset);
        const select = new vscode.Selection (
            shiftHeld ? editorSelection.anchor : position, 
            position
        );
        newSelections.push(select);
    }
    editor.selections = newSelections;
    vscode.window.activeTextEditor?.revealRange(newSelections[0]);
    return newSelections[0];
}

export const punctuationStopsReg = /[\.\?\!\n\r]/;
export const punctuationNoWhitespace = /[\.\?\!]/;
export const fragmentStopReg = /[\-",;\*#~_()\[\]\{\}:/\\]/;

export type JumpSentenceOptions = {
    punctuationStops: RegExp,
    fragmentStops?: RegExp
}

export const defaultJumpSentenceOptions = {
    punctuationStops: punctuationStopsReg,
    fragmentStops: undefined
};

export const defaultJumpFragmentOptions = {
    punctuationStops: punctuationStopsReg,
    fragmentStops: fragmentStopReg
}

export async function jumpSentence (
    jt: JumpType, 
    shiftHeld: boolean, 
    options: JumpSentenceOptions = defaultJumpSentenceOptions

): Promise<vscode.Selection | null> {
    const direction = jt === 'forward' ? -1 : 1;
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    if (!document) return null;

    const docText = document.getText();

    const newSelections: vscode.Selection[] = [];
    for (const selection of editor.selections) {

        const start = selection.isReversed ? selection.start : selection.end;
        const anchor = selection.anchor;

        // If fragment jumps are activated, use all stopping characters as pause for fragments
        // Otherwise, use a regex that the internet told me would never, ever (tm) match anything
        const fragmentStop = options.fragmentStops || /^[]/;
        const punctuationStops = options.punctuationStops;
        
        const startOffset = document.offsetAt(start);
    
    
        // Initial iteration for forward jumps -- 
        // When chaining together forward sentence jumps, we come across and issue:
        // Initial: 'First sentence.  Current |sentence.  Last sentence.'
        // After jump one: 'First sentence. |Current sentence.  Last sentence.'
        // After jump two: 'First sentence. |Current sentence.  Last sentence.'
        //      In this case, we can see the cursor getting "stuck" on the current
        //          sentence -- no matter how many times we run `jumpSentence`, the 
        //          cursor will not move past the first '.' which it gets stuck to
        //      It's getting stuck because the main iteration (below) iterates forward
        //          until it reaches punctuation.  In this case the punctuation
        //          is the first '.' at the end of 'First sentence.', causing the 
        //          result of the main iteration to be 'First sentence|.'.  This looks 
        //          ugly, and is fixed by the use of a  secondary loop which pushes the 
        //          cursor back to "current" sentence:  'First sentence.  |Current sentence.'.  
        //          But, because of this, the cursor has no longer passed the period that 
        //          stopped it earlier, and then, when `jumpSentence` is run again,
        //          the cursor will get blocked by this '.' again, stopped, and then 
        //          brought back to it's initial position.  Continue forever.
        // The desired result for jump two is:
        //      '|First sentence.  Current sentence.  Last sentence.'     
        // To do this, if jumping forward, scoot past all leading whitespace and
        //      punctuation characters
        let initial = startOffset;
        if (jt === 'forward' && initial !== 0) {
            let current = initial - 1;
            while (
                (/\s/.test(docText[current]) || punctuationStops.test(docText[current]) || fragmentStop.test(docText[current]))
                && current !== 0
            ) {
                current--;
            }
            initial = current;
        }
        else if (jt === 'backward') {
    
            const isEol = docText[initial] === '\n';
            let current = initial;
            while (
                (/\s/.test(docText[current]) || punctuationStops.test(docText[current]) || fragmentStop.test(docText[current]))
            ) {
                current++;
            }
            initial = current;
        }
    
        // Ditto the above comment, but for jt === 'backward' and the problem character
        //      being '"' instead of punctuation
        if (jt === 'backward' && fragmentStop.test(docText[initial])) {
            if (docText[initial] === '-' && docText[initial + 1] === '-') {
                initial++;
            }
            initial++;
        }
    
        // Get the next non-whitespace and non-punctuation character following an offset
        const getNextNonPunctuationNonWhitespaceCharacter = (text: string, offset: number): {
            char: string,
            dist: number,
        } => {
            // Scan backward for next non-space, non-punctuation character
            let backwardChar;
            let backwardOff = offset + 1;
            let backwardDist = 1;
            do {
                backwardChar = text[backwardOff];
                if ((
                    !punctuationStops.test(backwardChar) 
                    && !/\s/.test(backwardChar)
                    && !/["\-,;\*#~_()\[\]\{\}]/.test(backwardChar)
                ) || backwardChar === undefined) {
                    break;
                }
                backwardOff++;
                backwardDist++;
            }
            while (true);
            return { char: backwardChar, dist: backwardDist };
        };
    
        let skip = false;
        if (initial !== startOffset) {
            const initialPosition = document.positionAt(initial);
            const startPosition = document.positionAt(startOffset);
            skip = initialPosition.line !== startPosition.line;
        }
    
    
        // Main iteration:
        // Traverse the document text -- forward or backward -- until we find punctuation or a special
        //      stopping character
        // And stop at that character
        // let finalColumn: number = -1;
        // if (initialColumn === relevantColumnBound) finalColumn = relevantColumnBound;
        let iterOffset = initial;
        while (
            !skip && (
            (jt === 'forward' && iterOffset !== 0) || 
            (jt === 'backward' && iterOffset !== docText.length))
        ) {
            const iterationCharacter = docText[iterOffset];
            
            // CASE: the current character matches a punction
            if (punctuationStops.test(iterationCharacter)) {
                // Fragment jumps always pause at any punctuation
                if (options.fragmentStops) {
                    break;
                }
                // Sentence jumps sometimes do not pause at punctuation because of the existence of mid-sentece punctuation
                //      such as an acronym "C.H.O.A.M.", a mid-sentence question "What is a meter? ten feet?",
                //      or mid-sentence elipses "I know what that means... revenge!"
                // Read the next non-punctuation and non-whitespace character after the current offset
                // If the following character is a capital letter, then break here and jump to this offset
                // If the following character is a double quotes mark, then break here and jump to this offset
                // If the following character is a capital letter BUT it came right after the stopped punctuation
                //      then assume that the reason for the pause was because of an acronym "C.H.O.A.M." and continue
                //      iterating
                const after = getNextNonPunctuationNonWhitespaceCharacter(docText, iterOffset);
                if (/[A-Z]/.test(after.char) && after.dist !== 1) {
                    break;
                }
    
                // None of any of the above applies if we're talking about a new line
                if (iterationCharacter === '\r' || iterationCharacter === '\n') {
                    break;
                }
            }
    
            // CASE: the current character matches a special fragment stopping character
            if (fragmentStop.test(iterationCharacter)) {
                let stop = true;
                // Special case to not stop at '-' when the dash is one half of an em dash
                if (iterationCharacter === '-') {
                    if (docText[iterOffset + direction] === '-') {
                        iterOffset += direction;
                        iterOffset += direction;
                    }
                    else {
                        stop = false;
                    }
                }

                // Special case to not stop at single quote when it's used as an apostrophe
                if (iterationCharacter === "'") {
                    const reg = /[a-zA-Z]/;
                    if (reg.test(docText[iterOffset + 1]) && reg.test(docText[iterOffset - 1])) {
                        stop = false;
                    }
                }

                if (stop) {
                    if (jt === 'forward') {
                        iterOffset++;
                    }
                    break;
                }
            }
    
            iterOffset += direction;
        }
    
        // Now, post jump, position will look like this:
        // Initial state: 
        //     'This is the previous sentence.  This is the current| sentence.  This is the next one.'
        // Forward jump: 
        //     'This is the previous sentence|.  This is the current sentence.  This is the next one.'
        // Backward jump:
        //     'This is the previous sentence.  This is the current sentence|.  This is the next one.'
    
        // This, while passable, is slightly miss-aligned for my taste, so we're going to re-align
        //      the sentence jumps to what one might expect
        // New forward jump:
        //     'This is the previous sentence.  |This is the current sentence.  This is the next one.'
        // New backward jump:
        //     'This is the previous sentence.  This is the current sentence.|  This is the next one.'
    
        // Final position of the cursor
        let position: vscode.Position;
    
        // CASE: forward jump -- skip backward in the document past all punctuation and whitespace until
        //      we reach the beginning of the sentence where we started
        if (jt === 'forward') {
            let current = iterOffset;
            while (
                /\s/.test(docText[current]) || 
                punctuationStops.test(docText[current]) || 
                fragmentStop.test(docText[current])
            ) {
                current++;
            }
            position = document.positionAt(current);
        }
        // CASE: backward jump -- skip backward in the document past all punctuation
        else {
            let current = iterOffset;
            while (
                punctuationNoWhitespace.test(docText[current])
            ) {
                current++;
            }
            position = document.positionAt(current);
        }
    
        // More special cases for when reaching a new line
        // Whenever we move downwards to a new line, we want to start at the beginning of 
        //      that line
        if (position.line > start.line) {
            position = new vscode.Position(position.line, 0);
        }
        // Whenever we move upwards to a new line, we want to start at the end of the 
        //      next line
        else if (position.line < start.line) {
            const startOfNextLine = document.offsetAt(new vscode.Position(position.line + 1, 0));
            const endOfThisLine = startOfNextLine - 1;
            position = document.positionAt(endOfThisLine);
        }
    
        // Set the new selection of the editor
        const select = new vscode.Selection (
            // If shift is held, use the start position of the previous selection as the active point
            //      of the new selection
            shiftHeld ? anchor : position,
            position, 
        );
        newSelections.push(select);
    }
    editor.selections = newSelections;
    vscode.window.activeTextEditor?.revealRange(newSelections[0]);
    return newSelections[0];
}

export async function jumpParagraph (jt: JumpType, shiftHeld?: boolean): Promise<vscode.Selection | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    if (!document) return null;
    
    const docText = document.getText();

    const newSelections: vscode.Selection[] = [];
    for (const selection of editor.selections) {
        const start = selection.isReversed ? selection.start : selection.end;
        const line = start.line;
        const startOffset = document.offsetAt(start);
        
        const anchor = selection.anchor;
    
        // Find the position of the end of the line (paragraph)
        const nextLine = new vscode.Position(line + 1, 0);
        const nextLinePosition = document.offsetAt(nextLine);
        let eolPosition; 
        
        const eolLen = document.eol === vscode.EndOfLine.LF ? 1 : vscode.EndOfLine.CRLF;
    
        // Special case for when the cursor is at the end of the document
        // Because of how vscode handles `new vscode.Position` when the line number
        //      is out of range, end of line position will incorrectly be set to 
        //      `docText.length - 1`
        if (startOffset === docText.length) {
            eolPosition = startOffset;
        }
        else {
            eolPosition = nextLinePosition - eolLen;
        }
    
        // Special case for when the cursor will be traveling to the end of the document
        // Again because of complications on `new vscode.Position`, when travelling to
        //      the end of the document, the cursor will be set to `docText.length - 1`
        //      mistakingly
        if (eolPosition === docText.length - eolLen && !/\s/.test(docText[eolPosition])) {
            eolPosition = docText.length;
        }
        
        // Find the jump position, depending on whether we're jumping forward or backward
        let position: vscode.Position;
    
        if (jt === 'forward') {
            if (start.character === 0) {
                // If we are already at the start of a line (paragraph) and we're jumping forward
                //      then jump to the preceeding non-whitespace character
                // Character before the first character in a line is always a newline
                const preceedingNewline = startOffset - 1;
                // Character before newline is the last character in a line
                let preceedingParagraphOffset = preceedingNewline - 1;
                let preceedingParagraphCharacter = docText[preceedingParagraphOffset];
                while (/\s/.test(preceedingParagraphCharacter)) {
                    preceedingParagraphOffset -= 1;
                    preceedingParagraphCharacter = docText[preceedingParagraphOffset];
                    if (preceedingParagraphOffset === 0) {
                        preceedingParagraphOffset = 0;
                        break;
                    } 
                }
                position = document.positionAt(preceedingParagraphOffset + 1);
            }
            else {
                // If not at the beginning of a line (paragraph), then jump there
                position = new vscode.Position(line, 0);
            }
        }
        else {
            if (startOffset === eolPosition) {
                // Ditto for all the comments above, but going backwards
                const nextNewline = startOffset + 1;
                // Character before newline is the last character in a line
                let nextParagraphOffset = nextNewline + 1;
                let nextParagraphCharacter = docText[nextParagraphOffset];
                while (/\s/.test(nextParagraphCharacter)) {
                    nextParagraphOffset += 1;
                    nextParagraphCharacter = docText[nextParagraphOffset];
                    if (nextParagraphOffset === docText.length) {
                        nextParagraphOffset = docText.length - 1;
                        break;
                    } 
                }
                position = document.positionAt(nextParagraphOffset);
            }
            else {
                // If not at the end of a line (paragrapg, then jump there)
                position = document.positionAt(eolPosition);
            }
        }
    
        // Set the new selection of the editor
        const select =  new vscode.Selection (
            // If shift is held, use the start position of the previous selection as the active point
            //      of the new selection
            shiftHeld ? anchor : position,
            position, 
        );
        newSelections.push(select);
    }
    editor.selections = newSelections;
    vscode.window.activeTextEditor?.revealRange(newSelections[0]);
    return newSelections[0];
}