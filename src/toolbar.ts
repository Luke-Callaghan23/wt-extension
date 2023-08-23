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

    const punctuation = /[\.\?\!\n]/
    const whitespace = /\s/;

    
    // Offset for end of line is found by getting the offset of the first character
    //      of the next line and subtracting one (meaning the character prior to the 
    //      first character of the next line (meaning the last character of this line
    //      (meaning the end of the line for you, buckaroo))), and then subtract the
    //      the offset for the beginning of this current line
    const backwardColumnBound = 
        document.offsetAt(new vscode.Position(start.line + 1, 0)) - 1
        - document.offsetAt(new vscode.Position(start.line, 0));
    
    // Offset for the beginning of the line is 0
    const forwardColumnBound = 0;

    const relevantColumnBound = jt === 'forward'
        ? forwardColumnBound
        : backwardColumnBound;

    const lineNumber = start.line;
    const initialColumn = start.character;
    let columnOffset = 0;

    const initialCharacterOffset = document.offsetAt(new vscode.Position(lineNumber, initialColumn));
    const initialCharacter = docText[initialCharacterOffset];

    const preceedingCharacterOffset = initialCharacterOffset + direction;
    const preceedingCharacter = docText[preceedingCharacterOffset];

    if (initialCharacter === '"' || punctuation.test(initialCharacter)) {
        // If the initial character is on top of a punctuation or '"', then move it away
        columnOffset += direction;
    }

    if (preceedingCharacter === '"' || punctuation.test(preceedingCharacter)) {
        columnOffset += direction;
        columnOffset += direction;
    }

    let finalColumn: number = -1;
    if (initialColumn === relevantColumnBound) finalColumn = relevantColumnBound;
    while (initialColumn !== relevantColumnBound) {
        
        // CASE: the relevant column bounding was reached
        const iterationColumn = initialColumn + columnOffset;
        if (iterationColumn === relevantColumnBound) {
            finalColumn = relevantColumnBound;
            break;
        }
        
        const iterationCharacterOffset = document.offsetAt(new vscode.Position(lineNumber, iterationColumn));
        const iterationCharacter = docText[iterationCharacterOffset];

        // CASE: the current character matches a punction
        if (punctuation.test(iterationCharacter)) {
            finalColumn = iterationColumn;
            break;
        }

        // CASE: the current character matches special stopping character '"'
        if (iterationCharacter === '"') {
            if (jt === 'forward') {
                finalColumn = iterationColumn + 1;
            }
            else {
                finalColumn = iterationColumn;
            }
            break;
        }

        columnOffset += direction;
    }

    // Used for chaining multiple sentence jumps in a row
    let position: vscode.Position;
    if (finalColumn === initialColumn) {
        if (finalColumn === relevantColumnBound) {

            if (jt === 'forward' && document.offsetAt(new vscode.Position(start.line, finalColumn)) === 0) {
                // Special case for when the final column is 1 and jump is forward:
                // Long story short, going through the code below, the result would
                //      move the column forward 1 (the while loop would test docText[-1], fall through
                //      and increment the offset + 1 for forward jump, leading to position=1)
                // So, to prepare for this, just set the position to 0, 0
                position = new vscode.Position(0, 0);
            }
            else {
                
                // If final is initial and final is also the relevant column bound,
                //      then skip all whitespace 
                let currentOffset = document.offsetAt(new vscode.Position(start.line, finalColumn));
                let currentCharacter = docText[currentOffset + direction];
                while (whitespace.test(currentCharacter)) {
    
                    currentOffset += direction;
                    currentCharacter = docText[currentOffset];
    
                    if (jt === 'forward' && currentOffset === 0) {
                        // Set to -1 instead of 0, as right after this loop breaks,
                        //      we add one to the `currentOffset` counter
                        currentOffset = -1;
                        break;
                    }
                    else if (jt === 'backward' && currentOffset === docText.length) {
                        currentOffset = docText.length;
                        break;
                    }
                }
                if (jt === 'forward') {
                    currentOffset += 1;
                }
                position = document.positionAt(currentOffset);
            }
        }
        else {
            position = new vscode.Position(start.line, finalColumn);
        }
    }
    else {
        position = new vscode.Position(start.line, finalColumn);
    }

    // Set the new selection of the editor
    const select = new vscode.Selection (
        // If shift is held, use the start position of the previous selection as the active point
        //      of the new selection
        shiftHeld ? anchor : position,
        position, 
    );
    editor.selection = select;
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
    const eolPosition = nextLinePosition - 1;

    
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
    editor.selection = select;
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