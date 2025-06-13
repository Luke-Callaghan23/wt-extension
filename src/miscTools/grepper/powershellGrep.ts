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

    if (!useRegex) {
        searchBarValue = searchBarValue.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (wholeWord) {
        // Basically a git grep command requires a very specific formatting for the special characters in a regex
        // So, we cannot rely on existing word separators that have been declared elsewhere in this project
        // Have to recreate the regex using these special word separators
        const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()\\!\\&\\"\'^_*~])';
        const shellWordSeparatorEnd = '(\\s|-|[.?:;,()\\!\\&\\"\'^_*~]|$)';
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
        
        if (ps.pid) {
            runningGreps[ps.pid] = ps;
        }

        for await (const line of readline.createInterface({ input: ps.stderr })) {
            console.error(line);
            console.error(line);

            console.error(line);
            console.error(line);
            console.error(line);

            console.error(line);
            console.error(line);
            console.error(line);

            console.error(line);
            console.error(line);
            console.error(line);

            console.error(line);
            console.error(line);
            console.error(line);

            console.error(line);
        }

        cancellationToken.onCancellationRequested(() => {
            if (ps.pid && ps.pid in runningGreps) {
                delete runningGreps[ps.pid];
            }
            ps.kill();
            cancelled = true;
        })

        // Any "finished" operation for the grep command should reset the git state back to its original
        // Iterate over lines from the stdout of the git grep command and yield each line provided to us
        for await (const line of readline.createInterface({ input: ps.stdout })) {
            yield line.toLocaleLowerCase().replaceAll(extension.rootPath.fsPath.toLocaleLowerCase(), '');
        }

        if (ps.pid && ps.pid in runningGreps) {
            delete runningGreps[ps.pid];
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