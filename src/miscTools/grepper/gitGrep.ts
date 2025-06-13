import * as vscode from 'vscode';
import * as extension from '../../extension';
import * as readline from 'readline';
import * as childProcess from 'child_process';
import { Grepper, GrepperGetter } from './findMyGrepper';

const runningGreps: Record<number, childProcess.ChildProcessWithoutNullStreams> = [];

export async function *gitGrep (
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

    const regex = new RegExp(searchBarValue);
    let flags: string = '-r';
    if (caseInsensitive) {
        flags += 'i';
    }

    
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
        const ps = childProcess.spawn(`git`, ['grep', flags, '-H', '-n', '-E', regex.source], {
            cwd: extension.rootPath.fsPath
        })
        // Any "finished" operation for the grep command should reset the git state back to its original
        .addListener('close', reset)
        .addListener('disconnect', reset)
        .addListener('exit', reset);

        if (ps.pid) {
            runningGreps[ps.pid] = ps;
        }

        for await (const line of readline.createInterface({ input: ps.stderr })) {
        }

        cancellationToken.onCancellationRequested(() => {
            if (ps.pid && ps.pid in runningGreps) {
                delete runningGreps[ps.pid];
            }
            ps.kill();
            cancelled = true;
        })

        // Iterate over lines from the stdout of the git grep command and yield each line provided to us
        for await (const line of readline.createInterface({ input: ps.stdout })) {
            yield line;  
        }

        if (ps.pid && ps.pid in runningGreps) {
            delete runningGreps[ps.pid];
        }
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}' regex.  Error: ${err}`);
        reset();
        return null;
    }
    reset();
}


export function findGitGrep (grepperGetter: GrepperGetter): Grepper | null {
    console.log('Using grepper [git grep]');
    return gitGrep;
}