// Web replacement for `grepExtensionDirectory.ts`: ripgrep is unavailable, so search with plain VS Code APIs.
import * as vscode from 'vscode';
import { nodeGrep, nodeGrepExtensionDirectory } from './nodeGrep';

export async function grepSingleFile (
    uri: vscode.Uri,
    searchBarValue: string, 
    useRegex: boolean, 
    useCaseInsensitive: boolean, 
    useWholeWord: boolean,
    useNodeDescriptions: boolean,
    useIgnoreStyleCharacters: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[vscode.Location, string][] | null> {
    const document = await vscode.workspace.openTextDocument(uri);
    return nodeGrep(document, searchBarValue, useRegex, useCaseInsensitive, useWholeWord, useNodeDescriptions, useIgnoreStyleCharacters, cancellationToken);
}

export async function grepExtensionDirectory (
    searchBarValue: string, 
    useRegex: boolean, 
    useCaseInsensitive: boolean, 
    useWholeWord: boolean,
    useIgnoreStyleCharacters: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null>  {
    return nodeGrepExtensionDirectory(searchBarValue, useRegex, useCaseInsensitive, useWholeWord, cancellationToken);
}
