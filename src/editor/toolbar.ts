/* eslint-disable curly */
import * as vscode from 'vscode';
import { gitCommit, gitiniter } from '../gitTransactions';
import { Workspace } from '../workspace/workspaceClass';
import { JumpType, defaultJumpFragmentOptions, jumpParagraph, jumpSentence, jumpWord } from './jumps';
import { bold, commasize, emDash, emDashes, italisize, strikethrough, underline } from './surroundSelection';
import { commentFragment, commentParagraph, commentSentence } from './comment';
import { highlightExpand } from './highlights';
import { addQuotes } from './addQuotes';
import { Accents } from './accents';
import { OutlineView } from '../outline/outlineView';
import { ExtensionGlobals } from '../extension';
import { vagueNodeSearch } from '../miscTools/help';


export function remove () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    return editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.replace(editor.selection, '');
    });
}



export async function save () {
    await vscode.commands.executeCommand('wt.tabStates.saveToCurrentTabGroup');
    await Workspace.packageContextItems();
    vscode.commands.executeCommand('wt.statusBarTimer.resetTimer');
    return gitCommit();
}

export async function saveAll () {
    await vscode.commands.executeCommand('wt.tabStates.saveToCurrentTabGroup');
    await Workspace.packageContextItems();
    vscode.commands.executeCommand('wt.statusBarTimer.resetTimer');
    return gitCommit();
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


export class Toolbar {
    static registerCommands() {
        vscode.commands.registerCommand('wt.editor.remove', remove);
        vscode.commands.registerCommand('wt.editor.save', save);
        vscode.commands.registerCommand('wt.editor.saveAll', saveAll);
        vscode.commands.registerCommand('wt.editor.italisize', italisize);
        vscode.commands.registerCommand('wt.editor.bold', bold);
        vscode.commands.registerCommand('wt.editor.strikethrough', strikethrough);
        vscode.commands.registerCommand('wt.editor.commasize', commasize);
        vscode.commands.registerCommand('wt.editor.underline', underline);
        vscode.commands.registerCommand('wt.editor.emdash', emDash);
        vscode.commands.registerCommand('wt.editor.emdashes', emDashes);

        vscode.commands.registerCommand("wt.editor.todo.commentSentence", commentSentence);
        vscode.commands.registerCommand("wt.editor.todo.commentFragment", commentFragment);
        vscode.commands.registerCommand("wt.editor.todo.commentParagraph", commentParagraph);

        vscode.commands.registerCommand('wt.editor.delete.forward', () => deleteSelection('forward'));
        vscode.commands.registerCommand('wt.editor.delete.backward', () => deleteSelection('backward'));

        vscode.commands.registerCommand('wt.editor.highlightExpand', highlightExpand);

        // Jump commands
        vscode.commands.registerCommand('wt.editor.jump.word.forward', () => jumpWord('forward'));
        vscode.commands.registerCommand('wt.editor.jump.word.backward', () => jumpWord('backward'));
        vscode.commands.registerCommand('wt.editor.jump.sentence.forward', () => jumpSentence('forward', false));
        vscode.commands.registerCommand('wt.editor.jump.sentence.backward', () => jumpSentence('backward', false));
        vscode.commands.registerCommand('wt.editor.jump.fragment.forward', () => jumpSentence('forward', false, defaultJumpFragmentOptions));
        vscode.commands.registerCommand('wt.editor.jump.fragment.backward', () => jumpSentence('backward', false, defaultJumpFragmentOptions));
        vscode.commands.registerCommand('wt.editor.jump.paragraph.forward', () => jumpParagraph('forward'));
        vscode.commands.registerCommand('wt.editor.jump.paragraph.backward', () => jumpParagraph('backward'));
        vscode.commands.registerCommand('wt.editor.jump.word.forward.shift', () => jumpWord('forward', true));
        vscode.commands.registerCommand('wt.editor.jump.word.backward.shift', () => jumpWord('backward', true));
        vscode.commands.registerCommand('wt.editor.jump.sentence.forward.shift', () => jumpSentence('forward', true));
        vscode.commands.registerCommand('wt.editor.jump.sentence.backward.shift', () => jumpSentence('backward', true));
        vscode.commands.registerCommand('wt.editor.jump.fragment.forward.shift', () => jumpSentence('forward', true, defaultJumpFragmentOptions));
        vscode.commands.registerCommand('wt.editor.jump.fragment.backward.shift', () => jumpSentence('backward', true, defaultJumpFragmentOptions));
        vscode.commands.registerCommand('wt.editor.jump.paragraph.forward.shift', () => jumpParagraph('forward', true));
        vscode.commands.registerCommand('wt.editor.jump.paragraph.backward.shift', () => jumpParagraph('backward', true));

        vscode.commands.registerCommand('wt.editor.addQuotes', () => addQuotes());

        const accent = new Accents();
        vscode.commands.registerCommand('wt.editor.accent.insertAccent', () => accent.addAccent());

        vscode.commands.registerCommand("wt.editor.revealVSCode", (tabUri: vscode.Uri) => {
            return vscode.commands.executeCommand('workbench.view.explorer');
        });
        vscode.commands.registerCommand("wt.editor.revealOutline", async (tabUri: vscode.Uri) => {
            const searchResult = await vagueNodeSearch(tabUri);
            if (searchResult === null) {
                return vscode.window.showErrorMessage(`[ERROR] Unable to find Outline fragment for uri '${tabUri.fsPath}'`);
            }
            switch (searchResult.source) {
                case 'outline': return ExtensionGlobals.outlineView.view.reveal(searchResult.node, {
                    expand: true,
                    select: true,
                });
                case 'recycle': return ExtensionGlobals.recyclingBinView.view.reveal(searchResult.node, {
                    expand: true,
                    select: true,
                });
                case 'scratch': return ExtensionGlobals.scratchPadView.view.reveal(searchResult.node, {
                    expand: true,
                    select: true,
                });
                case 'workBible': return ExtensionGlobals.workBible.view.reveal(searchResult.node, {
                    expand: true,
                    select: true,
                });
            }
        });
        vscode.commands.registerCommand("wt.editor.revealFileExplorer", (tabUri: vscode.Uri) => {
            try {
                return vscode.commands.executeCommand('remote-wsl.revealInExplorer', tabUri);
            }
            catch (err: any) {
                return vscode.commands.executeCommand('revealFileInOS', tabUri);
            }
        });
    }
}