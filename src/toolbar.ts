/* eslint-disable curly */
import * as vscode from 'vscode';
import { gitCommit, gitiniter } from './gitTransactions';
import * as console from './vsconsole';
import * as extension from './extension';
import { Workspace } from './workspace/workspaceClass';


// Function for surrounding selected text with a specified string
function surroundSelectionWith (start: string, end?: string) {

    end = end || start;

    // Get the active text editor
    const editor = vscode.window.activeTextEditor;

    if (!editor) return;

    const document = editor.document;
    const selection = editor.selection;

    // Get the selected text within the selection
    const selected = document.getText(selection);

    // Check if the string immediately before the selection is the same as the surround string
    let beforeSelection: vscode.Selection | undefined = undefined;
    {
        if (selected.startsWith(start)) {
            const newEnd = new vscode.Position(selection.start.line, selection.start.character + start.length);
            beforeSelection = new vscode.Selection(selection.start, newEnd);
        }
        else {
            if (selection.start.character >= start.length) {
                const newStart = new vscode.Position(selection.start.line, selection.start.character - start.length);
                beforeSelection = new vscode.Selection(newStart, selection.start);
                const beforeText = document.getText(beforeSelection);
                if (beforeText !== start) beforeSelection = undefined;
            }
        }
    }

    // Check if the string immediately after the selection is the same as the surround string
    let afterSelection: vscode.Selection | undefined = undefined;
    {
        if (selected.endsWith(end)) {
            const newStart = new vscode.Position(selection.end.line, selection.end.character - end.length);
            afterSelection = new vscode.Selection(newStart, selection.end);
        }
        else {
            const newEnd = new vscode.Position(selection.end.line, selection.end.character + end.length);
            afterSelection = new vscode.Selection(selection.end, newEnd);
            const afterText = document.getText(afterSelection);
            if (afterText !== start) afterSelection = undefined;
        }
    }

    if (afterSelection && !beforeSelection && selection.isEmpty) {
        // If only the substring after the selection is the surround string, then we're going to want
        //      to move the cursor outside of the the surround string
        // Simply shift the current editor's selection
        const currentOffset = editor.document.offsetAt(selection.end);
        const afterSurroundString = currentOffset + end.length;
        const afterSurroundPosition = editor.document.positionAt(afterSurroundString);
        editor.selection = new vscode.Selection(afterSurroundPosition, afterSurroundPosition);
    }
    else if (beforeSelection && afterSelection) {
        const before = beforeSelection as vscode.Selection;
        const after = afterSelection as vscode.Selection;
        // If both the before and after the selection are already equal to the surround string, then
        //      remove those strings
        editor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.delete(before);
            editBuilder.delete(after);
        });
    }
    else {
        // If before and after the selection is not already the surround string, add the surround string
    
        // Surround the selected text with the surround string
        const surrounded = `${start}${selected}${end}`;
    
        // Replace selected text with the surrounded text
        editor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.replace(selection, surrounded);
        }).then(() => {
            if (!selection.isEmpty) return;
            // If the selection is empty, then move the cursor into the middle of the surround strings
            //      that were added
            // After the edits, the current position of the cursor is at the end of the surround string
            const curEditor = vscode.window.activeTextEditor;
            if (!curEditor) return;
            const end = curEditor.selection.end;
            const startLength = start.length;

            // The new position is the same as the current position, minus the amount of characters in the 
            //      surround string
            const newPosition = new vscode.Position(end.line, end.character - startLength);

            // New selection is the desired position of the cursor (provided to the constructor twice, to
            //      get an empty selection)
            curEditor.selection = new vscode.Selection(newPosition, newPosition);
        });
    }
}

export function italisize () {
    return surroundSelectionWith('*');
}

export function bold () {
    return surroundSelectionWith('__');
}

export function strikethrough () {
    return surroundSelectionWith('~~');
}

export function commasize () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;
    if (!document) return;

    const text = document.getText();

    let startPos: vscode.Position = editor.selection.start;
    let startStr = ', ';

    let endPos: vscode.Position = editor.selection.end;
    let endStr = ', ';

    const startOffset = document.offsetAt(editor.selection.start);
    if (text[startOffset - 1] === ' ') {
        const prev = document.positionAt(startOffset - 1);
        startPos = prev;
        startStr = ',';
    }
    const endOffset = document.offsetAt(editor.selection.end);
    if (text[endOffset] === ' ') {
        endStr = ',';
    }
    editor.selection = new vscode.Selection(startPos, endPos);
    return surroundSelectionWith(startStr, endStr);
}

export function remove () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    return editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.replace(editor.selection, '');
    });
}


export function header () {
    // Since we defined comments in the the language configuration json
    //      as a hash '#', simply calling the default toggle comment command
    //      from vscode will toggle the heading
    return vscode.commands.executeCommand('editor.action.commentLine');
}


export async function save () {
    await Workspace.packageContextItems();
    return gitCommit();
}

export async function saveAll () {
    await Workspace.packageContextItems();
    return gitCommit();
}

type JumpType = 'forward' | 'backward'

async function emDash () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    return editor.edit((editBuilder: vscode.TextEditorEdit) => {
        let replace = ' -- ';

        // If the cursor is on a whitespace character, then insert only '-- ' instead of ' -- '
        const document = editor.document;
        if (editor.selection.isEmpty && document) {
            const offset = document.offsetAt(editor.selection.start);
            if (document.getText()[offset - 1] === ' ') {
                replace = '-- ';
            }
        }
        
        editBuilder.replace(editor.selection, replace);
    });
}

async function emDashes () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;
    if (!document) return;

    // Move the cursor backwards if the cursor is on a whitespace character
    const offset = document.offsetAt(editor.selection.start);
    if (editor.selection.isEmpty && document.getText()[offset - 1] === ' ') {
        const prev = document.positionAt(offset - 1);
        editor.selection = new vscode.Selection(prev, prev);
    }
    return surroundSelectionWith(' -- ');
}

async function deleteSelection (jt: JumpType): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    // Perform the delete on a specified selection
    const doDelete = async (selection: vscode.Selection): Promise<boolean> => {
        return editor.edit((editBuilder: vscode.TextEditorEdit) => editBuilder.replace(selection, ''));
    }

    // If selection is not empty, just delete the already selected area 
    const selection = editor.selection;
    if (!selection.isEmpty) {
        return doDelete(selection);
    }

    // If there is no selection, then use jumpWord to get select the area to delete
    const deleteSelection: vscode.Selection | null = await jumpWord(jt, true);
    if (deleteSelection === null) return false;
    return doDelete(deleteSelection);
}

async function jumpWord (jt: JumpType, shiftHeld?: boolean): Promise<vscode.Selection | null> {
    const direction = jt === 'forward' ? -1 : 1;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const editorSelection = editor.selection;

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
    editor.selection = select;
    vscode.window.activeTextEditor?.revealRange(editor.selection);
    return select;
}

async function jumpSentence (jt: JumpType, shiftHeld?: boolean): Promise<vscode.Selection | null> {
    const direction = jt === 'forward' ? -1 : 1;
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    if (!document) return null;

    const docText = document.getText();

    const selection = editor.selection;
    const start = selection.isReversed ? selection.start : selection.end;
    const anchor = selection.anchor;

    const punctuation = /[\.\?\!]/
    
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
            (/\s/.test(docText[current]) || punctuation.test(docText[current]) )
            && current !== 0
        ) {
            current--;

            // Special case: stop immediately at a '"' character -- special rules implemented
            //      to stop at dialogue tags
            if ('"' === docText[current]) break;
        }
        initial = current;
    }

    // Ditto the above comment, but for jt === 'backward' and the problem character
    //      being '"' instead of punctuation
    if (jt === 'backward' && docText[initial] === '"') {
        initial++;
    }  

    // More special forward cases:
    if (jt === 'forward') {
        // '"' stopping character: don't continue
        // Made it to 0 already: don't continue
        if (docText[initial] === '"' || initial === 0) {
            const position = document.positionAt(initial);
            // Set the new selection of the editor
            const select = new vscode.Selection (
                // If shift is held, use the start position of the previous selection as the active point
                //      of the new selection
                shiftHeld ? anchor : position,
                position, 
            );
            editor.selection = select;
            vscode.window.activeTextEditor?.revealRange(editor.selection);
            return select;
        }
    }


    // Main iteration:
    // Traverse the document text -- forward or backward -- until we find punctuation or a special
    //      stopping character
    // And stop at that character
    // let finalColumn: number = -1;
    // if (initialColumn === relevantColumnBound) finalColumn = relevantColumnBound;
    let iterOffset = initial;
    while (
        (jt === 'forward' && iterOffset !== 0) || 
        (jt === 'backward' && iterOffset !== docText.length)
    ) {
        const iterationCharacter = docText[iterOffset];
        
        // CASE: the current character matches a punction
        if (punctuation.test(iterationCharacter)) {
            break;
        }

        // CASE: the current character matches special stopping character '"'
        if (iterationCharacter === '"') {
            if (jt === 'forward') {
                iterOffset++;
            }
            break;
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
            punctuation.test(docText[current]) || 
            '"' === docText[current]
        ) {
            current++;
        }
        position = document.positionAt(current);
    }
    // CASE: backward jump -- skip backward in the document past all punctuation
    else {
        let current = iterOffset;
        while (
            punctuation.test(docText[current])
        ) {
            current++;
        }
        position = document.positionAt(current);
    }

    // Set the new selection of the editor
    const select = new vscode.Selection (
        // If shift is held, use the start position of the previous selection as the active point
        //      of the new selection
        shiftHeld ? anchor : position,
        position, 
    );
    editor.selection = select;
    vscode.window.activeTextEditor?.revealRange(editor.selection);
    return select;
}

async function jumpParagraph (jt: JumpType, shiftHeld?: boolean): Promise<vscode.Selection | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    if (!document) return null;
    
    const docText = document.getText();

    const selection = editor.selection;
    const start = selection.isReversed ? selection.start : selection.end;
    const line = start.line;
    const startOffset = document.offsetAt(start);
    
    const anchor = selection.anchor;

    // Find the position of the end of the line (paragraph)
    const nextLine = new vscode.Position(line + 1, 0);
    const nextLinePosition = document.offsetAt(nextLine);
    let eolPosition;
    
    // Special case for when the cursor is at the end of the document
    // Because of how vscode handles `new vscode.Position` when the line number
    //      is out of range, end of line position will incorrectly be set to 
    //      `docText.length - 1`
    if (startOffset === docText.length) {
        eolPosition = startOffset;
    }
    else {
        eolPosition = nextLinePosition - 1;
    }

    // Special case for when the cursor will be traveling to the end of the document
    // Again because of complications on `new vscode.Position`, when travelling to
    //      the end of the document, the cursor will be set to `docText.length - 1`
    //      mistakingly
    if (eolPosition === docText.length - 1 && !/\s/.test(docText[eolPosition])) {
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
        if (startOffset === eolPosition || 
            (startOffset === eolPosition - 1 && docText[startOffset] === '\r')      // Thanks windows
        ) {
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
    editor.selection = select;
    vscode.window.activeTextEditor?.revealRange(editor.selection);
    return select;
}

export class Toolbar {
    static registerCommands() {
        vscode.commands.registerCommand('wt.editor.remove', remove);
        vscode.commands.registerCommand('wt.editor.save', save);
        vscode.commands.registerCommand('wt.editor.saveAll', saveAll);
        vscode.commands.registerCommand('wt.editor.italisize', italisize);
        vscode.commands.registerCommand('wt.editor.bold', bold);
        vscode.commands.registerCommand('wt.editor.strikethrough', strikethrough);
        vscode.commands.registerCommand('wt.editor.commasize', commasize);
        vscode.commands.registerCommand('wt.editor.header', header);
        vscode.commands.registerCommand('wt.editor.emdash', emDash);
        vscode.commands.registerCommand('wt.editor.emdashes', emDashes);

        vscode.commands.registerCommand('wt.editor.delete.forward', () => deleteSelection('forward'));
        vscode.commands.registerCommand('wt.editor.delete.backward', () => deleteSelection('backward'));

        // Jump commands
        vscode.commands.registerCommand('wt.editor.jump.word.forward', () => jumpWord('forward'));
        vscode.commands.registerCommand('wt.editor.jump.word.backward', () => jumpWord('backward'));
        vscode.commands.registerCommand('wt.editor.jump.sentence.forward', () => jumpSentence('forward'));
        vscode.commands.registerCommand('wt.editor.jump.sentence.backward', () => jumpSentence('backward'));
        vscode.commands.registerCommand('wt.editor.jump.paragraph.forward', () => jumpParagraph('forward'));
        vscode.commands.registerCommand('wt.editor.jump.paragraph.backward', () => jumpParagraph('backward'));
        vscode.commands.registerCommand('wt.editor.jump.word.forward.shift', () => jumpWord('forward', true));
        vscode.commands.registerCommand('wt.editor.jump.word.backward.shift', () => jumpWord('backward', true));
        vscode.commands.registerCommand('wt.editor.jump.sentence.forward.shift', () => jumpSentence('forward', true));
        vscode.commands.registerCommand('wt.editor.jump.sentence.backward.shift', () => jumpSentence('backward', true));
        vscode.commands.registerCommand('wt.editor.jump.paragraph.forward.shift', () => jumpParagraph('forward', true));
        vscode.commands.registerCommand('wt.editor.jump.paragraph.backward.shift', () => jumpParagraph('backward', true));
    }
}