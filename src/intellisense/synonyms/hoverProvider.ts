import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { capitalize, getHoverText, getHoveredWord } from '../common';
import { WorldNotes } from '../../worldNotes/worldNotes';

export class HoverProvider implements vscode.HoverProvider {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {

    }

    async provideHover (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover> {
        const hoverPosition = getHoveredWord(document, position);
        if (!hoverPosition) return new vscode.Hover('');

        // Don't give hover on words that have a matched world notes Note
        const worldNotes = WorldNotes.singleton;
        if (worldNotes) {
            const matchedNotes = worldNotes.matchedNotes;
            if (
                matchedNotes 
                && matchedNotes.docUri.fsPath === document.uri.fsPath
                && matchedNotes.matches.find(note => note.range.contains(position))
            ) {
                return new vscode.Hover('');
            }
        }

        const hoverText = await getHoverText(hoverPosition?.text);

        // Create and return the new hover
        const startPosition = document.positionAt(hoverPosition.start);
        const endPosition = document.positionAt(hoverPosition.end);
        const selection = new vscode.Selection(startPosition, endPosition);
        return new vscode.Hover(hoverText, selection);
    }
}