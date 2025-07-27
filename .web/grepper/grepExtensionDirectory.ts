import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as extension from '../../extension';
import { wordSeparator } from '../../extension';
import * as readline from 'readline';
import { glob } from 'glob';
import {promisify} from 'util'
import { isSubdirectory } from '../help';

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

        console.log(inlineSearchRegex);

        const totalCount = documentPromises.length;
        let completedFilesCount = 0;
        while (completedFilesCount < totalCount) {
            const [ openedDoc, index ] = await Promise.any<[vscode.TextDocument, number]>(documentPromises
                .map((p, i) => p.then(v => [v, i] as [vscode.TextDocument, number]))
            );

            const lines = openedDoc.getText().split('\n');
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
                    const uri = openedDoc.uri;
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