import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../vsconsole';

export class HoverProvider implements vscode.HoverProvider {
    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace
    ) {

    }

    async provideHover (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Hover> {
        const stops = /[\.\?,\s\;'":\(\)\{\}\[\]\/\\\-!\*_]/;

        const text = document.getText();
        const off = document.offsetAt(position);
        const char = text[off];

        
        let start: number | undefined;
        let end: number | undefined;
        let goBack = true;
        let goForward = true;

        // Test to see if we should go back or go forward
        if (stops.test(char)) {

            // Check to see of the character before the cursor is a stopping character
            let beforeStops = false;
            if (off !== 0) {
                const before = text[off - 1];
                beforeStops = stops.test(before);
            }
            
            // Check to see if the character after the cursor is a stopping character
            let afterStops = false;
            if (off !== text.length - 1) {
                const after = text[off + 1];
                afterStops = stops.test(after);
            }

            if (!beforeStops) {
                // If the before character is not stopping, then don't go forward
                goForward = false;
                end = off;
            }
            // Going backwards is given precedence over going backwards
            // Ex: 'word| other words'
            //      where '|' is the hover
            else if (!afterStops) {
                // If the after character is not stopping, then don't go backward
                goBack = false;
                start = off + 1;
            }
            // If the cursor is on a stopping character and surrounded by stopping characters
            //      then return a new empty hover
            else return new vscode.Hover('', new vscode.Selection(0,0,0,0));
        }

        // If we should go back, then loop backawards until we find a stopping character -- 
        //      use that as the start of the hover string
        if (goBack) {
            let current = off - 1;
            while (!stops.test(text[current])) {
                current -= 1;
            }
            start = current + 1;
            goBack = false;
        }

        // If we should go forward, then loop forwards until we find a stopping character --
        //      use that as the end of the hover string
        if (goForward) {
            let current = off + 1;
            while (!stops.test(text[current])) {
                current += 1;
            }
            end = current;
            goForward = false;
        }

        if (goBack || goForward || !start || !end) return new vscode.Hover('', new vscode.Selection(0,0,0,0));
        const hoverText = text.substring(start, end);

        // Query the synonym api for the hovered word
        const response = await query(hoverText);
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
        const startPosition = document.positionAt(start);
        const endPosition = document.positionAt(end);
        const selection = new vscode.Selection(startPosition, endPosition);
        return new vscode.Hover(hoverResult, selection);
    }
}