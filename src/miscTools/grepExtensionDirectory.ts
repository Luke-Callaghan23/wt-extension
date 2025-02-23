import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as extension from '../extension';
import * as vscodeUri from 'vscode-uri';
import * as pathModule from 'path';
import { compareFsPath, isSubdirectory } from './help';
import { Workspace } from '../workspace/workspaceClass';

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
        const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()\\!\\&+n\\"\'^_*~])';
        const shellWordSeparatorEnd = '(\\s|-|[.?:;,()\\!\\&+n\\"\'^_*~]|$)';
        searchBarValue = `${shellWordSeparatorStart}${searchBarValue}${shellWordSeparatorEnd}`;
        
        inLineSearch = {
            regexWithIdGroup: new RegExp(`${shellWordSeparatorStart}(?<${captureGroupId}>${searchBarValue})${shellWordSeparatorEnd}`, 'gi'),
            captureGroupId: captureGroupId,
        }
    }

    const regex = new RegExp(searchBarValue, flags);

    let results: string[];
    try {

        // Temporarily add all unchecked files to git (so git grep will operate on them)
        const uncheckedFiles = await new Promise<string[]>((resolve, reject) => {
            childProcess.exec(`git ls-files --others --exclude-standard`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr);
                    return;
                }
                resolve(stdout.split('\n'));
            });
        });
        
        await new Promise<void>((resolve, reject) => {
            childProcess.exec(`git add ${uncheckedFiles.join(' ')}`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => resolve());
        });

        // Perform git grep
        results = await new Promise<string[]>((resolve, reject) => {
            childProcess.exec(`git grep -i -r -H -n -E "${regex.source}"`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => {
                console.log(`querying: ${`git grep -i -r -H -n -E "${regex.source}"`}`);
                console.error("error: ", error);
                console.info("stdout: ", stdout)
                console.error("stderr: ", stderr)
                if (error) {
                    if (stderr.length === 0) {
                        resolve([]);
                    }
                    else {
                        reject(stderr);
                    }
                    return;
                }
                resolve(stdout.split('\n'));
            });
        });

        console.log("results: ", results);

        /*

        Consider doing this to stream results from git grep

        const ps = childProcess.spawn('', {
        })

        addListener(event: 'error', listener: (err: Error) => void): this;
        addListener(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
        addListener(event: 'message', listener: (message: Serializable, sendHandle: SendHandle) => void): this;
        */


        // Reset all the previously unchecked files
        await new Promise<void>((resolve, reject) => {
            childProcess.exec(`git reset ${uncheckedFiles.join(' ')}`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => resolve());
        });
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}' regex.  Error: ${err}`);
        return null;
    }

    const locations: vscode.Location[] = [];

    const parseOutput = /(?<path>.+):(?<lineOneIndexed>\d+):(?<lineContents>.+)/;
    try {
        for (const result of results) {
            const match = parseOutput.exec(result);
            if (!match || match.length === 0 || !match.groups) continue;
    
            const captureGroup = match.groups as { path: string, lineOneIndexed: string, lineContents: string };
            const { path, lineContents, lineOneIndexed } = captureGroup;
            const line = parseInt(lineOneIndexed) - 1;

            const parseLineReg = inLineSearch?.regexWithIdGroup || new RegExp(regex.source, 'ig');
            let lineMatch: RegExpExecArray | null;
            while ((lineMatch = parseLineReg.exec(lineContents)) !== null) {
                let characterStart = lineMatch.index;
                if (characterStart !== 0) {
                    characterStart += 1;
                }

                const searchedText = inLineSearch && lineMatch.groups?.[inLineSearch.captureGroupId]
                    ? lineMatch.groups[inLineSearch.captureGroupId]
                    : lineMatch[lineMatch.length - 1];

                if (inLineSearch) {
                    characterStart += lineMatch[0].indexOf(searchedText);
                }
                
                const characterEnd = characterStart + searchedText.length;
    
                const startPosition = new vscode.Position(line, characterStart);
                const endPosition = new vscode.Position(line, characterEnd);
                const foundRange = new vscode.Selection(startPosition, endPosition);
        
                const uri = vscode.Uri.joinPath(extension.rootPath, path);
                if (
                    isSubdirectory(extension.ExtensionGlobals.workspace.chaptersFolder, uri)
                    || isSubdirectory(extension.ExtensionGlobals.workspace.workSnipsFolder, uri)
                    || isSubdirectory(extension.ExtensionGlobals.workspace.workBibleFolder, uri)
                ) {
                    locations.push(new vscode.Location(uri, foundRange));
                }
            }
        }

    }
    catch (err: any) {
        console.log(err);
    }
    console.log(locations);
    return locations;
}