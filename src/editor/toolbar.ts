/* eslint-disable curly */
import * as vscode from 'vscode';
import { gitCommit, gitiniter } from '../gitTransactions';
import { Workspace } from '../workspace/workspaceClass';
import { JumpType, defaultJumpFragmentOptions, getJumpWordSelection, jumpParagraph, jumpSentence, jumpWord } from './jumps';
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
    const doDelete = async (selections: vscode.Selection[]): Promise<boolean> => {
        const edits = selections.map(selection => {
            return editor.edit((editBuilder: vscode.TextEditorEdit) => editBuilder.replace(selection, ''));
        });
        return edits.every(elt => elt);
    }

    // If selection is not empty, just delete the already selected area 
    const selection = editor.selection;
    if (!selection.isEmpty) {
        return doDelete([selection]);
    }

    // If there is no selection, then use jumpWord to get select the area to delete
    const deleteSelection: vscode.Selection[] | null = await getJumpWordSelection(jt, true);
    if (deleteSelection === null) return false;
    return doDelete(deleteSelection);
}


export class Toolbar {
    static registerCommands(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.remove', remove));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.save', save));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.saveAll', saveAll));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.italisize', italisize));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.bold', bold));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.strikethrough', strikethrough));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.commasize', commasize));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.underline', underline));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.emdash', emDash));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.emdashes', emDashes));

        context.subscriptions.push(vscode.commands.registerCommand("wt.editor.todo.commentSentence", commentSentence));
        context.subscriptions.push(vscode.commands.registerCommand("wt.editor.todo.commentFragment", commentFragment));
        context.subscriptions.push(vscode.commands.registerCommand("wt.editor.todo.commentParagraph", commentParagraph));

        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.delete.left', () => deleteSelection('left')));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.delete.right', () => deleteSelection('right')));

        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.highlightExpand', highlightExpand));

        // Jump commands
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.word.left', () => jumpWord('left')));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.word.right', () => jumpWord('right')));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.sentence.left', () => jumpSentence('left', false)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.sentence.right', () => jumpSentence('right', false)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.fragment.left', () => jumpSentence('left', false, defaultJumpFragmentOptions)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.fragment.right', () => jumpSentence('right', false, defaultJumpFragmentOptions)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.paragraph.left', () => jumpParagraph('left')));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.paragraph.right', () => jumpParagraph('right')));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.word.left.shift', () => jumpWord('left', true)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.word.right.shift', () => jumpWord('right', true)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.sentence.left.shift', () => jumpSentence('left', true)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.sentence.right.shift', () => jumpSentence('right', true)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.fragment.left.shift', () => jumpSentence('left', true, defaultJumpFragmentOptions)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.fragment.right.shift', () => jumpSentence('right', true, defaultJumpFragmentOptions)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.paragraph.left.shift', () => jumpParagraph('left', true)));
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.jump.paragraph.right.shift', () => jumpParagraph('right', true)));

        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.addQuotes', () => addQuotes()));

        const accent = new Accents(context);
        context.subscriptions.push(vscode.commands.registerCommand('wt.editor.accent.insertAccent', () => accent.addAccent()));

        context.subscriptions.push(vscode.commands.registerCommand("wt.editor.revealVSCode", (tabUri: vscode.Uri) => {
            return vscode.commands.executeCommand('workbench.view.explorer');
        }));
        context.subscriptions.push(vscode.commands.registerCommand("wt.editor.revealOutline", async (tabUri: vscode.Uri) => {
            const searchResult = await vagueNodeSearch(tabUri);
            if (searchResult === null) {
                return vscode.window.showErrorMessage(`[ERROR] Unable to find Outline fragment for uri '${tabUri.fsPath}'`);
            }
            switch (searchResult.source) {
                case 'outline': return ExtensionGlobals.outlineView.expandAndRevealOutlineNode(searchResult.node, {
                    expand: true,
                    select: true,
                });
                case 'recycle': return ExtensionGlobals.recyclingBinView.expandAndRevealOutlineNode(searchResult.node, {
                    expand: true,
                    select: true,
                });
                case 'scratch': return ExtensionGlobals.scratchPadView.expandAndRevealOutlineNode(searchResult.node, {
                    expand: true,
                    select: true,
                });
                case 'notebook': return ExtensionGlobals.notebookPanel.view.reveal(searchResult.node, {
                    expand: true,
                    select: true,
                });
            }
        }));
        context.subscriptions.push(vscode.commands.registerCommand("wt.editor.revealFileExplorer", (tabUri: vscode.Uri) => {
            try {
                return vscode.commands.executeCommand('remote-wsl.revealInExplorer', tabUri);
            }
            catch (err: any) {
                return vscode.commands.executeCommand('revealFileInOS', tabUri);
            }
        }));
    }
}