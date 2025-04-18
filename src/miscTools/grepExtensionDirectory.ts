import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as extension from '../extension';
import * as vscodeUri from 'vscode-uri';
import * as pathModule from 'path';
import { compareFsPath, isSubdirectory } from './help';
import { Workspace } from '../workspace/workspaceClass';
import * as readline from 'readline';

export async function *grep (
    regex: RegExp,
): AsyncGenerator<string | null> {

    
    // For git grep to work on all files in a workspace, need to temporarily stage the untracked files in the 
    //      repo folder
    // First, search all unchecked
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

    // Function to remove all unchecked files from git once the grep operation finishes
    let resetCalled = false;
    const reset = async () => {
        if (resetCalled) return;
        resetCalled = true;
        await new Promise<void>((resolve, reject) => {
            childProcess.exec(`git reset ${uncheckedFiles.join(' ')}`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => resolve());
        });
    };

    try {
        // Stage unchecked files
        await new Promise<void>((resolve, reject) => {
            childProcess.exec(`git add ${uncheckedFiles.join(' ')}`, {
                cwd: extension.rootPath.fsPath
            }, (error, stdout, stderr) => resolve());
        });

        // Call git grep
        const ps = childProcess.spawn(`git`, ['grep', '-i', '-r', '-H', '-n', '-E', regex.source], {
            cwd: extension.rootPath.fsPath
        })
        // Any "finished" operation for the grep command should reset the git state back to its original
        .addListener('close', reset)
        .addListener('disconnect', reset)
        .addListener('exit', reset);

        // Iterate over lines from the stdout of the git grep command and yield each line provided to us
        for await (const line of readline.createInterface({ input: ps.stdout })) {
            yield line;  
        }
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}' regex.  Error: ${err}`);
        reset();
        return null;
    }
    reset();
}




export async function *grepExtensionDirectory (
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
): AsyncGenerator<[vscode.Location, string] | null>  {

    const captureGroupId = 'searchResult';

    // Output of a git grep command is of this format:
    // URI:ONE_INDEXED_LINE:CONTENTS_OF_LINE
    // This is not particularly helpful to us because if we want to generate vscode.Location objects
    //      we are missing the start and end range of the matched text
    // This function mainly exists to process the raw output of a git grep command output and 
    //      transform it into vscode.Location so it can be used elsewhere in the writing environment

    
    // inline search regex is a secondary regex which makes use of NodeJS's regex capture groups
    //      to do additional searches inside of CONTENTS_OF_LINE for the actual matched text
    let inlineSearchRegex: RegExp = new RegExp(`(?<${captureGroupId}>${searchBarValue})`, 'gi');

    let flags: string = 'g';
    
    if (caseInsensitive) {
        flags += 'i';
    }

    if (!useRegex) {
        // If the searchBarValue is not a regex, then we have to comment out all the regex characters
        //      inside of the text, as git grep and the rest of this function will assume searchBarValue
        //      is the text of a regex
        // This essentially "turns off" all the potential regex characters in the text and lets the 
        //      rest of the code pretend that searchBarValue is a regex
        searchBarValue = searchBarValue.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (wholeWord) {
        
        // Also must recreate the inline search
        inlineSearchRegex = new RegExp(`${extension.wordSeparator}(?<${captureGroupId}>${searchBarValue})${extension.wordSeparator}`, 'gi');

        // Basically a git grep command requires a very specific formatting for the special characters in a regex
        // So, we cannot rely on existing word separators that have been declared elsewhere in this project
        // Have to recreate the regex using these special word separators
        const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()\\!\\&+n\\"\'^_*~])';
        const shellWordSeparatorEnd = '(\\s|-|[.?:;,()\\!\\&+n\\"\'^_*~]|$)';
        searchBarValue = `${shellWordSeparatorStart}${searchBarValue}${shellWordSeparatorEnd}`;
    }

    const regex = new RegExp(searchBarValue, flags);

    const parseOutput: RegExp = /(?<path>.+):(?<lineOneIndexed>\d+):(?<lineContents>.+)/;

    for await (const result of grep(regex)) {
        console.log(result)
    }

    // Iterate over all items yielded by the grep generator to parse into vscode.Location
    //      objects and yield each one once processed
    for await (const result of grep(regex)) {
        // If `grep` returns null, then something went wrong with the search, and the whole thing should be treated as null
        if (result === null) return null;

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

            // No clue what this does... I just know I found an off by one error somewhere
            // if (characterStart !== 0) {
            //     characterStart += 1;
            // }

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
                yield [ new vscode.Location(uri, foundRange), lineMatch[0] ];
            }
        }
    }
}