import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { capitalize, getHoveredWord } from './common';
import { query } from './querySynonym';

export class HoverProvider implements vscode.HoverProvider {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {

    }

    async getHoverText (text: string): Promise<string> {

        // Query the synonym api for the hovered word
        const response = await query(text);
        if (response.type === 'error') {
            return response.message;
        }

        // Construct markdown string from defintitions of hovered word
        const word = capitalize(response.word);
        const header: string = `### ${word}:`;
        const definitions: string[] = response.definitions.map(({
            part,
            definitions
        }) => {
            const def = capitalize(definitions[0]);
            return `- (*${part}*) ${def}`
        });
        const defString = definitions.join('\n\n');
        const fullString = `${header}\n\n\n${defString}`;
        return fullString;
    }

    async provideHover (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover> {
        const hoverPosition = await getHoveredWord(document, position);
        if (!hoverPosition) return new vscode.Hover('');

        const hoverText = await this.getHoverText(hoverPosition?.text);

        // Create and return the new hover
        const startPosition = document.positionAt(hoverPosition.start);
        const endPosition = document.positionAt(hoverPosition.end);
        const selection = new vscode.Selection(startPosition, endPosition);
        return new vscode.Hover(hoverText, selection);
    }
}