import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as extension from '../extension';
import { wordSeparator } from '../extension';
import * as readline from 'readline';
import { glob } from 'glob';
import {promisify} from 'util'

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
    captureGroupId: string
): Promise<vscode.Location[] | null>  {

    let inLineSearch: {
        regexWithIdGroup: RegExp,
        captureGroupId: string,
    } | undefined;

    const flags = 'g' + (caseInsensitive ? 'i' : '');
    if (!useRegex) {
        searchBarValue = searchBarValue.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    if (wholeWord) {
        searchBarValue = `${wordSeparator}${searchBarValue}${wordSeparator}`;
        
        inLineSearch = {
            regexWithIdGroup: new RegExp(`${wordSeparator}(?<${captureGroupId}>${searchBarValue})${wordSeparator}`, 'gi'),
            captureGroupId: captureGroupId,
        }
    }

    const regex = new RegExp(searchBarValue, flags);

    try {
        const applicableUris = await getDataDirectoryPaths();

        const documentPromises: Thenable<vscode.TextDocument>[] = applicableUris
            .map(uri => vscode.workspace.openTextDocument(uri));

        const documents: vscode.TextDocument[] = [];

        const locations: vscode.Location[] = [];
        const totalCount = documentPromises.length;
        let completedFilesCount = 0;
        while (completedFilesCount < totalCount) {
            const [ openedDoc, index ] = await Promise.any<[vscode.TextDocument, number]>(documentPromises
                .map((p, i) => p.then(v => [v, i]))
            );

            const lines = openedDoc.getText().split('\n');
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const lineContents = lines[lineIndex];

                const parseLineReg = regex;
                let lineMatch: RegExpExecArray | null;
                let lastLineMatch: RegExpExecArray | undefined;
                while ((lineMatch = parseLineReg.exec(lineContents)) !== null) {
                    if (lineMatch.index === lastLineMatch?.index) {
                        break;
                    }
                    
                    let characterStart = lineMatch.index + 1;
                    const searchedText = lineMatch.groups && captureGroupId
                        ? lineMatch.groups[captureGroupId]
                        : lineMatch[lineMatch.length - 1];
            
                    if (captureGroupId) {
                        characterStart += lineMatch[0].indexOf(searchedText);
                    }
                    
                    const characterEnd = characterStart + searchedText.length;
            
                    const startPosition = new vscode.Position(lineIndex, characterStart);
                    const endPosition = new vscode.Position(lineIndex, characterEnd);
                    const foundRange = new vscode.Selection(startPosition, endPosition);
            
                    locations.push(new vscode.Location(openedDoc.uri, foundRange));
                    lastLineMatch = lineMatch;
                }
            }
            
            completedFilesCount++;
            documentPromises.splice(index, 1);
            documents.push(openedDoc);
        }
        return locations;
    }
    catch (err: any) {
        console.log(err);
        return [];
    }

}