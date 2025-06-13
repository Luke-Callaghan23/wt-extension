import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as extension from './../../extension';
import * as readline from 'readline';
import { Grepper } from './grepper';

export class GitGrep extends Grepper {

    protected get name(): string {
        return 'git';
    }

    protected getCommand(regexSource: string, caseInsensitive: boolean): string[] {
        let flags = '-r';
        if (caseInsensitive) {
            flags += 'i';
        }


        return ['grep', flags, '-H', '-n', '-E', regexSource];
    }


    public async *query (
        searchBarValue: string, 
        useRegex: boolean, 
        caseInsensitive: boolean, 
        wholeWord: boolean, 
        cancellationToken: vscode.CancellationToken
    ): AsyncGenerator<string | null> {
        
        let cancelled = false;
        for (const [pid, pastProcess] of Object.entries(Grepper.runningGreps)) {
            if (pastProcess.kill()) {
                delete Grepper.runningGreps[parseInt(pid)];
            }
        }
        const regex = this.createRegex(searchBarValue, useRegex, wholeWord);
        
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
            const ps = childProcess.spawn(`git`, this.getCommand(regex.source, caseInsensitive), {
                cwd: extension.rootPath.fsPath
            })
            // Any "finished" operation for the grep command should reset the git state back to its original
            .addListener('close', reset)
            .addListener('disconnect', reset)
            .addListener('exit', reset);

            if (ps.pid) {
                Grepper.runningGreps[ps.pid] = ps;
            }

            for await (const line of readline.createInterface({ input: ps.stderr })) {
            }

            cancellationToken.onCancellationRequested(() => {
                if (ps.pid && ps.pid in Grepper.runningGreps) {
                    delete Grepper.runningGreps[ps.pid];
                }
                ps.kill();
                cancelled = true;
            })

            // Iterate over lines from the stdout of the git grep command and yield each line provided to us
            for await (const line of readline.createInterface({ input: ps.stdout })) {
                yield line;  
            }

            if (ps.pid && ps.pid in Grepper.runningGreps) {
                delete Grepper.runningGreps[ps.pid];
            }
        }
        catch (err: any) {
            vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}' regex.  Error: ${err}`);
            reset();
            return null;
        }
        reset();
    }
}