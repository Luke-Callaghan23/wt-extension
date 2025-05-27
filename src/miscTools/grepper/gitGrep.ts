import * as vscode from 'vscode';
import * as extension from '../../extension';
import * as readline from 'readline';
import * as childProcess from 'child_process';
import { Grepper, GrepperGetter } from './findMyGrepper';

export async function *gitGrep (
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


export function findGitGrep (grepperGetter: GrepperGetter): Grepper | null {
    console.log('Using grepper [git grep]');
    return gitGrep;
}