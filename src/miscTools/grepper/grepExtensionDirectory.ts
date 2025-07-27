import * as vscode from 'vscode';
import * as extension from '../../extension';
import { isSubdirectory } from '../help';
import { Grepper } from './grepper';
import { showMeUrGreppers } from './findGreppers';

const grepper = showMeUrGreppers();

export async function grepExtensionDirectory (
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[vscode.Location, string][] | null>  {
    const captureGroupId = 'searchResult';

    // inline search regex is a secondary regex which makes use of NodeJS's regex capture groups
    //      to do additional searches inside of CONTENTS_OF_LINE for the actual matched text
    let inlineSource = searchBarValue;
    if (!useRegex) {
        inlineSource = inlineSource.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    let inlineSearchRegex: RegExp = new RegExp(`(?<${captureGroupId}>${inlineSource})`, 'gi');
    if (wholeWord) {
        inlineSearchRegex = new RegExp(`${extension.wordSeparator}(?<${captureGroupId}>${inlineSource})${extension.wordSeparator}`, 'gi');
    }

    const parseOutput: RegExp = /(?<path>.+):(?<lineOneIndexed>\d+):(?<lineContents>.+)/;

    // Iterate over all items yielded by the grep generator to parse into vscode.Location
    //      objects and yield each one once processed
    const grepResult = await grepper.query(searchBarValue, useRegex, caseInsensitive, wholeWord, cancellationToken);
    if (grepResult.status === 'error') {
        vscode.commands.executeCommand('wt.wtSearch.searchError', searchBarValue, grepResult.message);
        return null;
    }

    const lines = grepResult.lines;

    const output: [vscode.Location, string][] = [];
    for (const result of lines) {
        // If `grep` returns null, then something went wrong with the search, and the whole thing should be treated as null
        if (cancellationToken.isCancellationRequested) return null;

        const match = parseOutput.exec(result);
        if (!match || match.length === 0 || !match.groups) continue;

        const captureGroup = match.groups as { path: string, lineOneIndexed: string, lineContents: string };
        const { path, lineContents, lineOneIndexed } = captureGroup;
        const line = parseInt(lineOneIndexed) - 1;

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
            const uri = vscode.Uri.joinPath(extension.rootPath, path);
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