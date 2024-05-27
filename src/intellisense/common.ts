import * as vscode from 'vscode';
import { SynonymsProvider } from './synonymsProvider/provideSynonyms';

export type HoverPosition = {
    start: number;
    end: number;
    text: string;
};

export type Capitalization = 'firstLetter' | 'allCaps' | 'noCapFrFrOnGod';
export function getTextCapitalization (text: string): Capitalization {
    let cap: Capitalization = 'noCapFrFrOnGod';
    let capCount = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (/[A-Z]/.test(char)) {
            if (index === 0) {
                cap = 'firstLetter';
            }
            capCount += 1;
        }
    }

    if (capCount === text.length) {
        cap = 'allCaps';
    }
    return cap;
}

export function transformToCapitalization (input: string, capitalization: Capitalization): string {
    switch (capitalization) {
        case 'allCaps': return input.toUpperCase();
        case 'firstLetter': return capitalize(input.toLocaleLowerCase());
        case 'noCapFrFrOnGod': return input.toLocaleLowerCase();
    }
}


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


const hoverText: { [index: string]: string } = {};
export async function getHoverText (text: string): Promise<string> {

    // If the hover text for the hovered word has already been calculated and stored in
    //      the hoverText dictionary, then use that string
    if (hoverText[text]) {
        return hoverText[text];
    }

    // Query the synonym api for the hovered word
    const response = await SynonymsProvider.provideSynonyms(text, 'synonymsApi');
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

    // Store the result string inside of the hover text dictionary so we don't query the same word
    //      over and over again
    hoverText[text] = fullString;

    return fullString;
}

export function capitalize (str: string): string {
    const end = str.substring(1);
    return str[0].toLocaleUpperCase() + end;
}



export type WordRange = {
    text: string,
    range: vscode.Range,
};