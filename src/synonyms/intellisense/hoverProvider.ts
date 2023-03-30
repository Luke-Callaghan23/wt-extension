import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';
import { getHoveredWord } from './common';

export class HoverProvider implements vscode.HoverProvider {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {

    }

    async provideHover (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover> {
        const hoverPosition = getHoveredWord(document, position);
        if (!hoverPosition) return new vscode.Hover('', new vscode.Selection(0,0,0,0));

        // Query the synonym api for the hovered word
        const response = await query(hoverPosition.text);
        if (!response) return new vscode.Hover('', new vscode.Selection(0,0,0,0));

        // Construct markdown string from defintitions of hovered word
        const header: string = `###${response.word}`;
        const definitions: string[] = response.definitions.map(({
            part,
            definitions
        }) => {
            const def = definitions[0];
            return `(**${part}**) ${def}`
        });
        const defString = definitions.join('\n\n');

        const hoverResult = new vscode.MarkdownString(`${header}
        
        
        ${defString}`);

        // Create and return the new hover
        const startPosition = document.positionAt(hoverPosition.start);
        const endPosition = document.positionAt(hoverPosition.end);
        const selection = new vscode.Selection(startPosition, endPosition);
        return new vscode.Hover(hoverResult, selection);
    }
}