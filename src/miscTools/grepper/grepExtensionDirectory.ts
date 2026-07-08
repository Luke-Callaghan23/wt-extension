import * as vscode from 'vscode';
import { Extension } from   '../../extension';
import { formatFsPathForCompare, getRelativePath, isSubdirectory } from '../help';
import { RipGrep } from './ripGrep';
import { buildMarkdownIgnoringRegex } from './common';

export async function grepSingleFile (
    uri: vscode.Uri,
    searchBarValue: string, 
    useRegex: boolean, 
    useCaseInsensitive: boolean, 
    useWholeWord: boolean,
    useIgnoreStyleCharacters: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[vscode.Location, string][] | null> {
    const fmtUri = './' + getRelativePath(uri);
    return grep__impl(searchBarValue, useRegex, useCaseInsensitive, useWholeWord, useIgnoreStyleCharacters, cancellationToken, fmtUri);
}

export async function grepExtensionDirectory (
    searchBarValue: string, 
    useRegex: boolean, 
    useCaseInsensitive: boolean, 
    useWholeWord: boolean,
    useIgnoreStyleCharacters: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[vscode.Location, string][] | null>  {
    return grep__impl(searchBarValue, useRegex, useCaseInsensitive, useWholeWord, useIgnoreStyleCharacters, cancellationToken);
}


async function grep__impl (
    searchBarValue: string, 
    useRegex: boolean, 
    useCaseInsensitive: boolean, 
    useWholeWord: boolean,
    useIgnoreStyleCharacters: boolean,
    cancellationToken: vscode.CancellationToken,
    overrideFilter?: string,
): Promise<[vscode.Location, string][] | null>  {
    
    const parseOutput: RegExp = /(?<path>.+):(?<lineOneIndexed>\d+):(?<characterOneIndexed>\d+):(?<matchedText>.+)/;

    // Iterate over all items yielded by the grep generator to parse into vscode.Location
    //      objects and yield each one once processed
    const grepResult = await RipGrep.query(searchBarValue, useRegex, useCaseInsensitive, useWholeWord, useIgnoreStyleCharacters, cancellationToken, overrideFilter);
    if (grepResult.status === 'error') {
        Extension.searchBarView.setSearchBarError(searchBarValue, grepResult.message);
        return null;
    }

    const lines = grepResult.lines;

    const output: [vscode.Location, string][] = [];
    for (const result of lines) {
        // If `grep` returns null, then something went wrong with the search, and the whole thing should be treated as null
        if (cancellationToken.isCancellationRequested) return null;

        // Parse path, line, character, and matched text from ripgrep output
        const match = parseOutput.exec(result);
        if (!match || match.length === 0 || !match.groups) continue;

        const captureGroup = match.groups as { path: string, lineOneIndexed: string, matchedText: string, characterOneIndexed: string };
        const { path, matchedText, lineOneIndexed, characterOneIndexed } = captureGroup;

        if (!path || !matchedText || !lineOneIndexed || !characterOneIndexed) {
            console.log(`[WARN] Skipped search result '${result}' from ripgrep because not all match groups were found: ${JSON.stringify({ path: path || null, matchedText: matchedText || null, lineOneIndexed: lineOneIndexed || null, characterOneIndexed: characterOneIndexed || null })}`)
            continue;
        }

        // Shift 1-indexed line and character to VSCode 0-indexed numbers and create a vscode.Range object
        const lineIdx = parseInt(lineOneIndexed) - 1;
        const characterIdx = parseInt(characterOneIndexed) - 1;

        if (isNaN(lineIdx) || isNaN(characterIdx)) {
            console.log(`[WARN] Skipped search result '${result}' from ripgrep because of invalid number formats for line or character: ${JSON.stringify({ lineOneIndexed: lineOneIndexed || null, characterOneIndexed: characterOneIndexed || null })}`);
            continue;
        }
        
        const matchedRange = new vscode.Range(
            new vscode.Position(lineIdx, characterIdx),
            new vscode.Position(lineIdx, characterIdx + matchedText.length),
        );

        // As long as the Uri belongs to this vscode workspace then yield this location
        const uri = vscode.Uri.joinPath(Extension.rootPath, path);
        if (
            (
                uri.fsPath.toLocaleLowerCase().endsWith('.wt') 
                || uri.fsPath.toLocaleLowerCase().endsWith('.wtnote') 
                || uri.fsPath.toLocaleLowerCase().endsWith('.md') 
                || uri.fsPath.toLocaleLowerCase().endsWith('.config')
            )
            && 
            (
                isSubdirectory(Extension.workspace.chaptersFolder, uri)
                || isSubdirectory(Extension.workspace.workSnipsFolder, uri)
                || isSubdirectory(Extension.workspace.notebookFolder, uri)
                || isSubdirectory(Extension.workspace.scratchPadFolder, uri)
            )
        ) {
            // Finally, finally, finally yield the result
            console.log(`[INFO] Search result: ${matchedText} in ${formatFsPathForCompare(uri)}, line ${matchedRange.start.line} char ${matchedRange.start.character}"`);
            output.push([ new vscode.Location(uri, matchedRange), matchedText ]);
        }
    }
    return output;
}