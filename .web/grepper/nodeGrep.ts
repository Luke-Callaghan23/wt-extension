import { isSubdirectory } from '../help';
import * as extension from './../../extension'
import * as vscode from 'vscode';



export function parseGrepOptions (
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
): RegExp {
    const captureGroupId = 'searchResult';
        
    let flags = 'g';
    if (caseInsensitive) {
        flags += 'i';
    }

    // inline search regex is a secondary regex which makes use of NodeJS's regex capture groups
    //      to do additional searches inside of CONTENTS_OF_LINE for the actual matched text
    let inlineSource = searchBarValue;
    if (!useRegex) {
        inlineSource = inlineSource.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    let inlineSearchRegex = new RegExp(`(?<${captureGroupId}>${inlineSource})`, flags);
    if (wholeWord) {
        inlineSearchRegex = new RegExp(`${extension.wordSeparator}(?<${captureGroupId}>${inlineSource})${extension.wordSeparator}`, flags);
    }
    return inlineSearchRegex;
}


export async function nodeGrep (
    document: vscode.TextDocument,
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null>;


export async function nodeGrep (
    document: vscode.TextDocument,
    inlineSearchRegex: RegExp,
    cancellationToken: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null>;

export async function nodeGrep (
    document: vscode.TextDocument,
    searchBarValueOrInlineSearchRegex: string | RegExp, 
    useRegexOrCancelationToken: boolean | vscode.CancellationToken, 
    caseInsensitive?: boolean, 
    wholeWord?: boolean,
    cancellationToken?: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null> {
    let inlineSearchRegex: RegExp;
    
    if (typeof searchBarValueOrInlineSearchRegex === 'string') {
        const searchBarValue = searchBarValueOrInlineSearchRegex;
        const useRegex = useRegexOrCancelationToken as boolean;
        caseInsensitive = caseInsensitive!;
        wholeWord = wholeWord!;
        cancellationToken = cancellationToken!;

        inlineSearchRegex = parseGrepOptions(searchBarValue, useRegex, caseInsensitive, wholeWord);

    }
    else {
        inlineSearchRegex = searchBarValueOrInlineSearchRegex as RegExp;
        cancellationToken = useRegexOrCancelationToken as vscode.CancellationToken;
    }

    const captureGroupId = 'searchResult';
    const output: [ vscode.Location, string ][] = [];

    const lines = document.getText().split('\n');
    for (let line = 0; line < lines.length; line++) {
        const lineContents = lines[line];

        let lineMatch: RegExpExecArray | null;

        // Since there can be multiple matched values for the search regex inside of CONTENTS_OF_LINE
        //      we need to continually apply the inlineSearchRegex to CONTENTS_OF_LINE until all matches 
        //      run out
        while ((lineMatch = inlineSearchRegex.exec(lineContents)) !== null) {
            let characterStart = lineMatch.index;

            // Using the captureGroupId we baked into the inlineSearchRegex, we can isolate just the current 
            //      matched text from the whole line
            const actualMatchedText = lineMatch.groups?.[captureGroupId] || lineMatch[lineMatch.length - 1];

            // In lined search results are also off-by-one
            if (inlineSearchRegex) {
                characterStart += lineMatch[0].indexOf(actualMatchedText);
            }

            // Index of the ending character of the vscode Location is derived by getting the starting character of the 
            //      of the grep result + the length of the searchedText
            const characterEnd = characterStart + actualMatchedText.length;

            // Create positions and ranges for the Location
            const startPosition = new vscode.Position(line, characterStart);
            const endPosition = new vscode.Position(line, characterEnd);
            const foundRange = new vscode.Selection(startPosition, endPosition);
    
            // As long as the Uri belongs to this vscode workspace then yield this location
            const uri = document.uri;
            if (
                (
                    uri.fsPath.toLocaleLowerCase().endsWith('.wt') 
                    || uri.fsPath.toLocaleLowerCase().endsWith('.wtnote') 
                    || uri.fsPath.toLocaleLowerCase().endsWith('.config')
                )
                && 
                (
                    isSubdirectory(extension.ExtensionGlobals.workspace.chaptersFolder, uri)
                    || isSubdirectory(extension.ExtensionGlobals.workspace.workSnipsFolder, uri)
                    || isSubdirectory(extension.ExtensionGlobals.workspace.notebookFolder, uri)
                    || isSubdirectory(extension.ExtensionGlobals.workspace.scratchPadFolder, uri)
                )
            ) {
                // Finally, finally, finally yield the result
                output.push([ new vscode.Location(uri, foundRange), actualMatchedText ]);
            }
        }
    }
    return output;
}