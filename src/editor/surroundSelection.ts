import * as vscode from 'vscode';

// Function for surrounding selected text with a specified string
export async function surroundSelectionWith (startRanges: string | string[], endRanges?: string | string[], overrideSelections?: vscode.Selection[]) {
    // Get the active text editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    
    endRanges = endRanges || startRanges;
    const document = editor.document;
    for (let selIndex = 0; selIndex < editor.selections.length; selIndex++) {
        const selection = editor.selections[selIndex];

        const start = Array.isArray(startRanges) ? startRanges[selIndex % startRanges.length] : startRanges;
        const end = Array.isArray(endRanges) ? endRanges[selIndex % endRanges.length] : endRanges;

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

            if (!selection.isEmpty) continue;

            // If the selection is empty, then move the cursor into the middle of the surround strings
            //      that were added
            // After the edits, the current position of the cursor is at the end of the surround string
            const endPos = selection.end;
            const startSequenceLength = start.length;

            // The new position is the same as the current position, minus the amount of characters in the 
            //      surround string
            const newPosition = new vscode.Position(endPos.line, endPos.character + startSequenceLength);

            // New selection is the desired position of the cursor (provided to the constructor twice, to
            //      get an empty selection)
            const replaceSelection = new vscode.Selection(newPosition, newPosition);
            const sels = [ ...editor.selections ];
            sels[selIndex] = replaceSelection;
            editor.selections = sels;
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

    
    const newSelections: vscode.Selection[] = [];
    const starts: string[] = [];
    const ends: string[] = [];
    for (const selection of editor.selections) {
        let startPos: vscode.Position = selection.start;
        let startStr = ', ';
    
        let endPos: vscode.Position = selection.end;
        let endStr = ', ';
    
        let diff: number = 1;
    
        // Check if the character before the cursor is a space
        // If so, then move the cursor back to before the space and only insert ',' instead of ', '
        const startOffset = document.offsetAt(selection.start);
        while (text[startOffset - diff] === ' ') {
            const prev = document.positionAt(startOffset - diff);
            startPos = prev;
            startStr = ',';
            diff++;
        }
        if (text[startOffset] === ' ') startStr = ',';
        if (text[startOffset - 1] === ',' && text[startOffset - 2] === ' ') startStr = ',';
        
        // Check if the character before the cursor is a space
        // If so, then insert only insert ',' instead of ', '
        diff = 1;
        const endOffset = document.offsetAt(selection.end);
        while (text[endOffset - diff] === ' ') {
            const prev = document.positionAt(endOffset - diff);
            endPos = prev;
            endStr = ',';
            diff++;
        }
        if (text[endOffset] === ' ') endStr = ',';
        if (text[endOffset + 0] === ',' && text[endOffset + 1] === ' ') endStr = ',';
    
        newSelections.push(new vscode.Selection(startPos, endPos));
        starts.push(startStr);
        ends.push(endStr);
    }
    editor.selections = newSelections;
    return surroundSelectionWith(starts, ends);
}

export async function emDash () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    for (const selection of editor.selections) {
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            let replace = ' -- ';
            
            // If the cursor is on a whitespace character, then insert only '-- ' instead of ' -- '
            const document = editor.document;
            if (selection.isEmpty && document) {
                const offset = document.offsetAt(selection.start);
                if (document.getText()[offset - 1] === ' ') {
                    replace = '-- ';
                }
            }
            
            editBuilder.replace(selection, replace);
        });
    }
}

export async function emDashes () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;
    if (!document) return;

    const text = document.getText();
    
    // Move the cursor backwards if the cursor is on a whitespace character
    const newSelections: vscode.Selection[] = [];
    const starts: string[] = [];
    const ends: string[] = [];
    for (let selIndex = 0; selIndex < editor.selections.length; selIndex++) {
        const selection = editor.selections[selIndex];
        
        let startPos: vscode.Position = selection.start;
        let startStr = ' -- ';
    
        let endPos: vscode.Position = selection.end;
        let endStr = ' -- ';
    
        let diff: number = 1;

        
        // Check if the character before the cursor is a space
        // If so, then move the cursor back to before the space and only insert ',' instead of ', '
        const startOffset = document.offsetAt(selection.start);
        while (text[startOffset - diff] === ' ') {
            const prev = document.positionAt(startOffset - diff);
            startPos = prev;
            startStr = !selection.isEmpty ? ' --' : ' -- ';
            diff++;
        }
        if (text[startOffset] === ' ') startStr = !selection.isEmpty ? ' --' : ' -- ';
        
        const endOffset = document.offsetAt(selection.end);

        // If the substring after the cursor is an emdash, then the surroundSelectionWith function will be moving
        //      the cursor to after the em dash.  In which case we don't want to move or edit the 
        //      end selection at all
        const beforeEmDash = text.substring(endOffset, endOffset+4) === ' -- ';
        if (beforeEmDash) {
            // Check if the character before the cursor is a space
            // If so, then insert only insert ' -- ' instead of ', '
            diff = 1;
            while (text[endOffset - diff] === ' ') {
                const prev = document.positionAt(endOffset - diff);
                endPos = prev;
                endStr = ' --';
                diff++;
            }
            if (text[endOffset] === ' ') endStr = ' --';
        }
    
    
        newSelections.push(new vscode.Selection(startPos, endPos));
        starts.push(startStr);
        ends.push(endStr);
    }
    editor.selections = newSelections;
    return surroundSelectionWith(starts, ends);
}