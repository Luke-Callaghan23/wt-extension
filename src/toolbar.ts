/* eslint-disable curly */
import * as vscode from 'vscode';
import { gitCommit, gitiniter } from './gitTransactions';
import * as console from './vsconsole';
import * as extension from './extension';
import { Buff } from './Buffer/bufferSource';


// Function for surrounding selected text with a specified string
function surroundSelectionWith (surround: string) {
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
        if (selected.startsWith(surround)) {
            const newEnd = new vscode.Position(selection.start.line, selection.start.character + surround.length);
            beforeSelection = new vscode.Selection(selection.start, newEnd);
        }
        else {
            if (selection.start.character >= surround.length) {
                const newStart = new vscode.Position(selection.start.line, selection.start.character - surround.length);
                beforeSelection = new vscode.Selection(newStart, selection.start);
                const beforeText = document.getText(beforeSelection);
                if (beforeText !== surround) beforeSelection = undefined;
            }
        }
    }

    // Check if the string immediately after the selection is the same as the surround string
    let afterSelection: vscode.Selection | undefined = undefined;
    {
        if (selected.endsWith(surround)) {
            const newStart = new vscode.Position(selection.end.line, selection.end.character - surround.length);
            afterSelection = new vscode.Selection(newStart, selection.end);
        }
        else {
            const newEnd = new vscode.Position(selection.end.line, selection.end.character + surround.length);
            afterSelection = new vscode.Selection(selection.end, newEnd);
            const afterText = document.getText(afterSelection);
            if (afterText !== surround) afterSelection = undefined;
        }
    }

    if (afterSelection && !beforeSelection && selection.isEmpty) {
        // If only the substring after the selection is the surround string, then we're going to want
        //      to move the cursor outside of the the surround string
        // Simply shift the current editor's selection
        const currentOffset = editor.document.offsetAt(selection.end);
        const afterSurroundString = currentOffset + surround.length;
        const afterSurroundPosition = editor.document.positionAt(afterSurroundString);
        editor.selection = new vscode.Selection(afterSurroundPosition, afterSurroundPosition);
    }
    else if (beforeSelection && afterSelection) {
        const before = beforeSelection as vscode.Selection;
        const after = afterSelection as vscode.Selection;
        // If both the before and after the selection are already equal to the surround string, then
        //      remove those strings
        editor.edit(editBuilder => {
            editBuilder.delete(before);
            editBuilder.delete(after);
        });
    }
    else {
        // If before and after the selection is not already the surround string, add the surround string
    
        // Surround the selected text with the surround string
        const surrounded = `${surround}${selected}${surround}`;
    
        // Replace selected text with the surrounded text
        editor.edit(editBuilder => {
            editBuilder.replace(selection, surrounded);
        }).then(() => {
            if (!selection.isEmpty) return;
            // If the selection is empty, then move the cursor into the middle of the surround strings
            //      that were added
            // After the edits, the current position of the cursor is at the end of the surround string
            const curEditor = vscode.window.activeTextEditor;
            if (!curEditor) return;
            const end = curEditor.selection.end;
            const surroundLength = surround.length;

            // The new position is the same as the current position, minus the amount of characters in the 
            //      surround string
            const newPosition = new vscode.Position(end.line, end.character - surroundLength);

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

export function remove () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    return editor.edit(editBuilder => {
        editBuilder.replace(editor.selection, '');
    });
}


export function header () {
    // Since we defined comments in the the language configuration json
    //      as a hash '#', simply calling the default toggle comment command
    //      from vscode will toggle the heading
    return vscode.commands.executeCommand('editor.action.commentLine');
}

async function packageContextItems () {
    // Write context items to the file system before git save
    const contextItems: { [index: string]: any } = await vscode.commands.executeCommand('wt.getPackageableItems');
    const contextJSON = JSON.stringify(contextItems);
    const contextUri = vscode.Uri.joinPath(extension.rootPath, `data/contextValues.json`);
    return vscode.workspace.fs.writeFile(contextUri, Buff.from(contextJSON, 'utf-8'));
}

export async function save () {
    await packageContextItems();
    return gitCommit();
}

export async function saveAll () {
    await packageContextItems();
    return gitCommit();
}

type JumpType = 'forward' | 'backward'

async function emDash () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    return editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.replace(editor.selection, ' -- ');
    });
}

async function emDashes () {
    return surroundSelectionWith(' -- ');
}

async function deleteSelection (jt: JumpType): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    // Perform the delete on a specified selection
    const doDelete = async (selection: vscode.Selection): Promise<boolean> => {
        return editor.edit(editBuilder => editBuilder.replace(selection, ''));
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

    // Move away from space characters
    let char = docText[offset];
    while (char && char === ' ') {
        offset += direction;
        char = docText[offset];
    }

    // Main movement: 
    const stopRegex = /[\s\.\?,"'-\(\)\[\]\{\}/\\]/;
    if (stopRegex.test(char)) {
        // If the cursor is initially at a stop character, then go until we find a non-stop character
        while (char && stopRegex.test(char)) {
            offset += direction;
            char = docText[offset];
        }
    }
    else {
        // If the cursor is at a non-stop character, then go until we find a stop character
        // (Also allow the character apostrophe character to be jumped -- as we don't want to stutter on the word 'don't')
        while (char && (char === "'" || !stopRegex.test(char))) {
            offset += direction;
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

    const punctuation = /[\.\?\!]|[^\s]--\s/
    const whitespace = /\s/;
    
    // Need to track both the first 
    let lastWhitespace = false;
    let firstWhitespace: number | null = null;

    let specialEndCondition;
    let columnPosition = start.character;
    let found: number = -1;

    // Special case, jump sentence foreward is called in this situation:
    //      `Hello, this is a sentence.|`
    //      Where '|' is the cursor
    // Need to adjust the start point for the loop to before the punctuation
    // Without adjustment, loop will always end instantly, and no movement will 
    //      be made as the cursor is searching for the first punctuation
    // Expected result:
    //      `|Hello, this is a sentence.`
    // Result without adjustment:
    //      `Hello, this is a sentence.|`
    let oneMore = false;
    while (columnPosition > 0 && punctuation.test(docText[document.offsetAt(new vscode.Position(start.line, columnPosition))-1])) {
        oneMore = true;
        columnPosition--;
    }
    if (oneMore) {
        columnPosition--;
    }
    
    while (true) {

        // Temporary column position to be used in the below loop without editing columnPosition
        let tmpCol = columnPosition;
        
        // Current position in the document (and temp variable to store it)
        let currentPosition = document.offsetAt(new vscode.Position(start.line, tmpCol));
        const tmpPosition = currentPosition;
        
        let passes = 0;
        while (punctuation.test(docText[currentPosition])) {
            tmpCol += direction;
            currentPosition = document.offsetAt(new vscode.Position(start.line, tmpCol));
            passes += 1;
        }

        // Test for the '-- ' condition

        // Special conditions for tracking whitespace
        // Whitespace needs to be tracked because the algorithm for searching for punctuation
        //      is too greedy when going forward.  Need to be able to track all instances where 
        //      a new area of whitespace was formed
        // This is stored in `firstWhitespace`
        // First whitespace tells the position of the starting point of the last chunk of whitespace
        //      before puncuation
        if (whitespace.test(docText[currentPosition])) {
            if (!lastWhitespace) {
                firstWhitespace = currentPosition;
            }
            lastWhitespace = true;
        }
        else {
            lastWhitespace = false;
        }

        // Condition for when there is no sentence markers until be beginning or end of paragraph
        if (jt === 'forward') {
            specialEndCondition = columnPosition === 0;
        }
        else {
            specialEndCondition = currentPosition === docText.length || docText[currentPosition] === '\n' || docText[currentPosition] === '\r';
        }
        if (passes > 0 || specialEndCondition) {
            found = tmpPosition + passes;
            break;
        }

        columnPosition += direction;
    }

    // Now we need to reorient the position of the cursor, depending on whether we're going forward or
    //      backwards
    if (jt === 'forward' && !specialEndCondition) {
        // If jumping forward and column !== 0, then the cursor will look like this:
        //      `Sentence before target|.  Target sentence.`
        //      Where '|' is the cursor.
        // We want the cursor to look like this:
        //      `Sentence before target.  |Target sentence.`
        if (firstWhitespace !== null) {
            found = firstWhitespace + 1;
        }
    }
    else if (jt === 'backward' && !specialEndCondition) {
        // If jumping backwards and the cursor is not at the end of the current paragraph or document
        //      AND there is multiple punc
        // Then the cursor could look like this:
        //      `Target sentence.|..  Sentence after target sentence.`
        //      Where '|' is the cursor
        // We want the cursor to look like this:
        //      `Target sentence...|  Sentence after target sentence.`

    }
    if (found === -1) return null;
    
    // Set the new selection of the editor
    const position: vscode.Position = document.positionAt(found);
    const select = new vscode.Selection (
        position, 
        // If shift is held, use the start position of the previous selection as the active point
        //      of the new selection
        shiftHeld ? start : position
    );
    editor.selection = select;
    return select;
}

async function jumpParagraph (jt: JumpType, shiftHeld?: boolean): Promise<vscode.Selection | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    if (!document) return null;

    const selection = editor.selection;
    const start = selection.isReversed ? selection.start : selection.end;
    const line = start.line;

    // Find the jump position, depending on whether we're jumping forward or backward
    let position: vscode.Position;
    if (jt === 'forward') {
        position = new vscode.Position(line, 0);
    }
    else {

        // Jumping backwards -> find position for the next line, and subtract one
        const nextLine = new vscode.Position(line + 1, 0);
        const nextLinePosition = document.offsetAt(nextLine);
        const eolPosition = nextLinePosition - 1;

        position = document.positionAt(eolPosition);
    }

    // Set the new selection of the editor
    const select = new vscode.Selection (
        position, 
        // If shift is held, use the start position of the previous selection as the active point
        //      of the new selection
        shiftHeld ? start : position
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