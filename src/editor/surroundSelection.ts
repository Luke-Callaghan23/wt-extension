import * as vscode from 'vscode';

// Function for surrounding selected text with a specified string
export async function surroundSelectionWith (start: string, end?: string) {
    // Get the active text editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    
    const document = editor.document;
    for (let selIndex = 0; selIndex < editor.selections.length; selIndex++) {
        const selection = editor.selections[selIndex];
        end = end || start;

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
                if (afterText !== end) afterSelection = undefined;
            }
        }
    
        if (afterSelection && !beforeSelection && selection.isEmpty) {
            // If only the substring after the selection is the surround string, then we're going to want
            //      to move the cursor outside of the the surround string
            // Simply shift the current editor's selection
            const currentOffset = editor.document.offsetAt(selection.end);
            const afterSurroundString = currentOffset + end.length;
            const afterSurroundPosition = editor.document.positionAt(afterSurroundString);
            const ns = [ ...editor.selections ];
            ns[selIndex] = new vscode.Selection(afterSurroundPosition, afterSurroundPosition);
            editor.selections = ns;
        }
        else if (beforeSelection && afterSelection) {
            const before = beforeSelection as vscode.Selection;
            const after = afterSelection as vscode.Selection;
            // If both the before and after the selection are already equal to the surround string, then
            //      remove those strings
            await editor.edit((editBuilder: vscode.TextEditorEdit) => {
                editBuilder.delete(before);
                editBuilder.delete(after);
            });
        }
        else {
            // If before and after the selection is not already the surround string, add the surround string
        
            // Surround the selected text with the surround string
            const surrounded = `${start}${selected}${end}`;
        
            // Replace selected text with the surrounded text
            await editor.edit((editBuilder: vscode.TextEditorEdit) => {
                editBuilder.replace(selection, surrounded);
            });
        }
    }
}

export function italisize () {
    return surroundSelectionWith('*');
}

export function bold () {
    return surroundSelectionWith('^');
}

export function strikethrough () {
    return surroundSelectionWith('~');
}

export function underline () {
    return surroundSelectionWith('_');
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

export async function emDash () {
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

export async function emDashes () {
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