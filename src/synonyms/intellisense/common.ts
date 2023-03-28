import * as vscode from 'vscode';

type HoverPosition = {
    start: number;
    end: number;
    text: string;
};

export function getHoveredWord (document: vscode.TextDocument, position: vscode.Position): HoverPosition | null {
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
        else return null;
    }

    // If we should go back, then loop backawards until we find a stopping character -- 
    //      use that as the start of the hover string
    if (goBack) {
        let current = off - 1;
        while (text[current] && !stops.test(text[current])) {
            current -= 1;
        }
        start = current + 1;
        goBack = false;
    }

    // If we should go forward, then loop forwards until we find a stopping character --
    //      use that as the end of the hover string
    if (goForward) {
        let current = off + 1;
        while (text[current] && !stops.test(text[current])) {
            current += 1;
        }
        end = current;
        goForward = false;
    }

    if (goBack || goForward || !start || !end) return null;
    return {
        start, end,
        text: text.substring(start, end)
    };
}


export function capitalize (str: string): string {
    const end = str.substring(1);
    return str[0].toLocaleUpperCase() + end;
}