import * as vscode from 'vscode';
import { SynonymProviderType, SynonymsProvider } from './synonymsProvider/provideSynonyms';
import { capitalize, stripDiacritics } from '../miscTools/help';
import { Extension } from '../extension';

export type HoverPosition = {
    start: number;
    end: number;
    text: string;
    strippedText: string; // text stripped of diacritics like accent marks
};




export function getHoveredWord (document: vscode.TextDocument, position: vscode.Position): HoverPosition | null {
    const stops = /[\.\?,\s\;'":\(\)\{\}\[\]\/\\\-!\*_]/;

    const text = document.getText();
    const offset = document.offsetAt(position);
    let anchor = offset;

    if (offset === text.length) {
        if (offset === 0 || stops.test(text[offset - 1])) return null;
        anchor = offset - 1;
    }
    else if (stops.test(text[offset])) {
        if (offset > 0 && !stops.test(text[offset - 1])) {
            anchor = offset - 1;
        }
        else if (offset + 1 < text.length && !stops.test(text[offset + 1])) {
            anchor = offset + 1;
        }
        else {
            return null;
        }
    }

    let start = anchor;
    while (start > 0 && !stops.test(text[start - 1])) start--;

    let end = anchor;
    while (end < text.length && !stops.test(text[end])) end++;

    if (start === end) return null;

    const originalText = text.substring(start, end);
    const strippedText = stripDiacritics(originalText);
    return {
        start, end,
        text: originalText,
        strippedText: strippedText
    };
}

export function getWordBeforePosition (document: vscode.TextDocument, position: vscode.Position): HoverPosition | null {
    const stops = /[\.\?,\s\;'":\(\)\{\}\[\]\/\\\-!\*_]/;
    const text = document.getText();
    let end = document.offsetAt(position);
    let current = end - 1;

    while (current >= 0 && stops.test(text[current])) current--;
    if (current < 0) return null;

    end = current + 1;
    let start = current;
    while (start > 0 && !stops.test(text[start - 1])) start--;

    const originalText = text.substring(start, end);
    return {
        start,
        end,
        text: originalText,
        strippedText: stripDiacritics(originalText),
    };
}


const hoverMarkdownCache: Record<SynonymProviderType, Record<string, string>> = {
    synonymsApi: {},
    wh: {},
};
export async function getHoverMarkdown (text: string, provider: SynonymProviderType = 'synonymsApi'): Promise<string> {

    const stripped = stripDiacritics(text);

    // If the hover text for the hovered word has already been calculated and stored in
    //      the hoverText dictionary, then use that string
    if (hoverMarkdownCache[provider][stripped]) {
        console.log(`Hover cache hit for provider=${provider} and word=${text}`);
        return hoverMarkdownCache[provider][stripped];
    }

    // Query the synonym api for the hovered word
    const response = await SynonymsProvider.provideSynonyms(stripped, provider);
    if (response.type === 'error') {
        if (Extension.personalDictionary.search(text)) {
            return "### From your personal dictionary";
        }

        return response.message;
    }

    // Construct markdown string from defintitions of hovered word
    const word = capitalize(text);
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
    hoverMarkdownCache[provider][stripped] = fullString;

    return fullString;
}

export type WordRange = {
    text: string,
    range: vscode.Range,
};