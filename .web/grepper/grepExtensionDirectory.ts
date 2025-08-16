import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as extension from '../../extension';
import { wordSeparator } from '../../extension';
import * as readline from 'readline';
import { glob } from 'glob';
import {promisify} from 'util'
import { isSubdirectory } from '../help';
import { nodeGrep } from './nodeGrep';

export const captureGroupId = 'searchResult';


async function getDataDirectoryPaths(): Promise<vscode.Uri[]> {
    const found: vscode.Uri[] = [];
    async function walkDirectory(directory: vscode.Uri) {
        
        const files = await vscode.workspace.fs.readDirectory(directory);
        for (const [name, type] of files) {
            const filePath = vscode.Uri.joinPath(directory, name);

            if (type === vscode.FileType.Directory) {
                // Recursively walk subdirectories
                await walkDirectory(filePath);
            } 
            else if (type === vscode.FileType.File && (
                name.toLocaleLowerCase().endsWith('.wt') || name.toLocaleLowerCase().endsWith('.wtnote') || name.toLocaleLowerCase() === '.config')
            ) {
                found.push(filePath);
            }
        }
    }

    await walkDirectory(vscode.Uri.joinPath(extension.rootPath, 'data'));
    return found;
}

export async function grepSingleFile (
    uri: vscode.Uri,
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[vscode.Location, string][] | null> {
    const document = await vscode.workspace.openTextDocument(uri);
    return nodeGrep(document, searchBarValue, useRegex, caseInsensitive, wholeWord, cancellationToken);
}


export async function grepExtensionDirectory (
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null>  {

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

    let inlineSearchRegex: RegExp = new RegExp(`(?<${captureGroupId}>${inlineSource})`, flags);
    if (wholeWord) {
        inlineSearchRegex = new RegExp(`${extension.wordSeparator}(?<${captureGroupId}>${inlineSource})${extension.wordSeparator}`, flags);
    }

    const output: [ vscode.Location, string ][] = [];
    try {
        const applicableUris = await getDataDirectoryPaths();

        const documentPromises: Thenable<vscode.TextDocument>[] = applicableUris
            .map(uri => vscode.workspace.openTextDocument(uri));

        const documents: vscode.TextDocument[] = [];

        const totalCount = documentPromises.length;
        let completedFilesCount = 0;
        while (completedFilesCount < totalCount) {
            const [ openedDoc, index ] = await Promise.any<[vscode.TextDocument, number]>(documentPromises
                .map((p, i) => p.then(v => [v, i] as [vscode.TextDocument, number]))
            );

            const grepResults = await nodeGrep(openedDoc, inlineSearchRegex, cancellationToken);
            grepResults && output.push(...grepResults);
            
            completedFilesCount++;
            documentPromises.splice(index, 1);
            documents.push(openedDoc);
        }
        return output;
    }
    catch (err: any) {
        console.log(err);
        vscode.commands.executeCommand('wt.wtSearch.searchError', searchBarValue, `${err}`);
        return [];
    }

}