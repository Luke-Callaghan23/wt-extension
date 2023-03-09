/* eslint-disable curly */
import * as vscode from 'vscode';
import { gitCommitAll, gitCommitFile, gitiniter } from './gitTransactions';
import * as console from './vsconsole';
import * as extension from './extension';

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

    if (beforeSelection && afterSelection) {
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
    surroundSelectionWith('*');
}

export function bold () {
    surroundSelectionWith('__');
}

export function strikethrough () {
    surroundSelectionWith('~~');
}

export function remove () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    editor.edit(editBuilder => {
        editBuilder.replace(editor.selection, '');
    });
}


export function header () {
    // Since we defined comments in the the language configuration json
    //      as a hash '#', simply calling the default toggle comment command
    //      from vscode will toggle the heading
    vscode.commands.executeCommand('editor.action.commentLine');
}

async function packageContextItems () {
    // Write context items to the file system before git save
    const contextItems: { [index: string]: any } = await vscode.commands.executeCommand('wt.getPackageableItems');
    const contextJSON = JSON.stringify(contextItems);
    const contextUri = vscode.Uri.joinPath(extension.rootPath, `data/contextValues.json`);
    await vscode.workspace.fs.writeFile(contextUri, Buffer.from(contextJSON, 'utf-8'));
}

export async function save () {
    await packageContextItems();
    gitCommitFile();
}

export async function saveAll () {
    await packageContextItems();
    gitCommitAll();
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
    }
}