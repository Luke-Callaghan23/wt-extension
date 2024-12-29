import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as extension from '../extension';
import * as readline from 'readline';
import { glob } from 'glob';
import {promisify} from 'util'

export async function grepExtensionDirectory (regex: RegExp, captureGroupId?: string): Promise<vscode.Location[] | null>  {

    const files: string[] = (await Promise.all([
        glob.glob(`${extension.rootPath.fsPath}/**/*.wt`),
        glob.glob(`${extension.rootPath.fsPath}/**/*.wtnote`),
        glob.glob(`${extension.rootPath.fsPath}/**/.config`),
    ])).flat();;

    const documentPromises: Thenable<vscode.TextDocument>[] = files
        .map(file => vscode.Uri.file(file))
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

            const parseLineReg = new RegExp(regex.source, 'ig');
            let lineMatch: RegExpExecArray | null;
            while ((lineMatch = parseLineReg.exec(lineContents)) !== null) {
                let characterStart = lineMatch.index;
                if (characterStart !== 0) {
                    characterStart += 1;
                }
        
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
            }
        }
        
        completedFilesCount++;
        documentPromises.splice(index, 1);
        documents.push(openedDoc);
    }

    return locations;
}