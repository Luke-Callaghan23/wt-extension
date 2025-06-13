import * as vscode from 'vscode';
import * as extension from '../../extension';
import * as readline from 'readline';
import * as childProcess from 'child_process';
import { Grepper, GrepperGetter } from './findMyGrepper';

const runningGreps: Record<number, childProcess.ChildProcessWithoutNullStreams> = [];

export async function *powershellGrep (
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
    cancellationToken: vscode.CancellationToken
): AsyncGenerator<string | null> {

    let cancelled = false;
    for (const [pid, pastProcess] of Object.entries(runningGreps)) {
        if (pastProcess.kill()) {
            delete runningGreps[parseInt(pid)];
        }
    }

    // Output of a git grep command is of this format:
    // URI:ONE_INDEXED_LINE:CONTENTS_OF_LINE
    // This is not particularly helpful to us because if we want to generate vscode.Location objects
    //      we are missing the start and end range of the matched text
    // This function mainly exists to process the raw output of a git grep command output and 
    //      transform it into vscode.Location so it can be used elsewhere in the writing environment


    if (!useRegex) {
        // If the searchBarValue is not a regex, then we have to comment out all the regex characters
        //      inside of the text, as git grep and the rest of this function will assume searchBarValue
        //      is the text of a regex
        // This essentially "turns off" all the potential regex characters in the text and lets the 
        //      rest of the code pretend that searchBarValue is a regex
        searchBarValue = searchBarValue.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (wholeWord) {
        

        // Basically a git grep command requires a very specific formatting for the special characters in a regex
        // So, we cannot rely on existing word separators that have been declared elsewhere in this project
        // Have to recreate the regex using these special word separators
        const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()!&"\'^_*~])';
        const shellWordSeparatorEnd = '(\\s|-|[.?:;,()!&"\'^_*~]|$)';
        searchBarValue = `${shellWordSeparatorStart}${searchBarValue}${shellWordSeparatorEnd}`;
    }
    
    const caseSensitive: string[] | string = !caseInsensitive
        ? '-CaseSensitive'
        : [];

    const regex = new RegExp(searchBarValue);

    try {
        const source = regex.source.replaceAll('\\"', '`"');

        const args = [ 'get-childitem', '-Recurse', '-Include', '"*.wtnote",', '"*.wt",', '"*.config"', '|', 'select-string', '-Pattern', `"${source}"`, caseSensitive, "|", "foreach", "{", '"$_"', "}"].flat();

        // Call git grep
        const ps = childProcess.spawn('powershell.exe', args, {
            cwd: extension.rootPath.fsPath
        });
        // Any "finished" operation for the grep command should reset the git state back to its original
        // Iterate over lines from the stdout of the git grep command and yield each line provided to us
        for await (const line of readline.createInterface({ input: ps.stdout })) {
            yield line.toLocaleLowerCase().replaceAll(extension.rootPath.fsPath.toLocaleLowerCase(), '');
        }
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}' regex.  Error: ${err}`);
        return null;
    }
}

export function findPowershellGrep (grepperGetter: GrepperGetter): Grepper | null {
    try {
        childProcess.execSync(`${grepperGetter} powershell.exe`);
        console.log('Using grepper [powershell]');
        return powershellGrep;
    }
    catch (err: any) {
        return null;
    }
}