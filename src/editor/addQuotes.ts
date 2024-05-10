import * as vscode from 'vscode';

export async function addQuotes (quoteKind: `'` | `"` = `"`): Promise<void> {
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    if (!document) return;

    
    const docText = document.getText();
    const lines = docText.split(/\n\r?/);
    
    const selections: vscode.Selection[] = [];
    for (let selectionIndex = 0; selectionIndex < editor.selections.length; selectionIndex++) {
        const selection = editor.selections[selectionIndex];
        const startPos = selection.start;
        const startLine = startPos.line;
        const lineText = lines[startLine];

        // If the selection is empty and the cursor is on top of a quote, then just skip past the quote
        const offset = document.offsetAt(selection.start);
        const offsetChar = docText[offset];
        if (offsetChar === quoteKind && selection.isEmpty) {
            const newSelection = editor.selections[selectionIndex].active;
            const newPosition = new vscode.Position(newSelection.line, newSelection.character+1);
            selections.push(new vscode.Selection(newPosition, newPosition));
            continue;
        }

        // When the selection is not empty, surround the text with quotes
        if (!selection.isEmpty) {
            const selectedText = document.getText(selection);
            await editor.edit(eb => {
                eb.replace(selection, `${quoteKind}${selectedText}${quoteKind}`);
            }, { undoStopAfter: true, undoStopBefore: true });
            selections.push(editor.selections[selectionIndex]);
            continue;
        }

        // Get the count of quotes on the line
        let quoteCount: number = 0;
        for (const char of lineText) {
            if (char === quoteKind) quoteCount++;
        }

        // EVEN ----> add two quotes
        if (quoteCount % 2 === 0) {
            const edited = await editor.edit(eb => {
                eb.replace(selection, `${quoteKind}${quoteKind}`);
            }, { undoStopAfter: true, undoStopBefore: true });

            // Since we're adding two quotes, we also want to move the cursor between the new quotes
            if (edited) {
                const newSelection = editor.selections[selectionIndex].active;
                const newPosition = new vscode.Position(newSelection.line, newSelection.character-1);
                selections.push(new vscode.Selection(newPosition, newPosition));
            }
        }
        // ODD ----> add one quote
        else {
            await editor.edit(eb => {
                eb.replace(selection, `${quoteKind}`);
            }, { undoStopAfter: true, undoStopBefore: true });
            selections.push(editor.selections[selectionIndex]);
        } 
    }
    editor.selections = selections;
}