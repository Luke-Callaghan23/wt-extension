import * as vscode from 'vscode';
import * as extension from '../../extension';
import * as readline from 'readline';
import * as childProcess from 'child_process';
import { Grepper, GrepperGetter } from './findMyGrepper';

const runningGreps: Record<number, childProcess.ChildProcessWithoutNullStreams> = [];

export async function *grepGrep (
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
        const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()!&"\'^_*~])';
        const shellWordSeparatorEnd = '(\\s|-|[.?:;,()!&"\'^_*~]|$)';
        searchBarValue = `${shellWordSeparatorStart}${searchBarValue}${shellWordSeparatorEnd}`;
    }

    let flags = '-r';
    if (caseInsensitive) {
        flags += 'i';
    }

    const regex = new RegExp(searchBarValue);

    try {
        // Call git grep
        const ps = childProcess.spawn(`grep`, [flags, '-n', '--include', '*.config', '--include', '*.wt', '--include', '*.wtnote', regex.source, './'], {
            cwd: extension.rootPath.fsPath
        })
        // Any "finished" operation for the grep command should reset the git state back to its original
        // Iterate over lines from the stdout of the git grep command and yield each line provided to us
        for await (const line of readline.createInterface({ input: ps.stdout })) {
            yield line;  
        }
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}' regex.  Error: ${err}`);
        return null;
    }
}


export function findGrepGrep (grepperGetter: GrepperGetter): Grepper | null {
    try {
        childProcess.execSync(`${grepperGetter} grep`);
        console.log('Using grepper [grep]');
        return grepGrep;
    }
    catch (err: any) {
        return null;
    }
}