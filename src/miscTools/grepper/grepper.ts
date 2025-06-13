import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import { RipGrep } from './ripGrep';
import { GrepGrep } from './grepGrep';
import { PowershellGrep } from './powershellGrep';
import { GitGrep } from './gitGrep';
import * as extension from './../../extension';
import * as readline from 'readline';

export type CmdLineSearch = 'get-command' | 'where' | 'which';


export abstract class Grepper {
    protected abstract get name (): string;
    protected abstract getCommand (regexSource: string, caseInsensitive: boolean): string[];

    protected getWordSeparators (): [ string, string ] {
        const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()\\!\\&\\"\'^_*~])';
        const shellWordSeparatorEnd = '(\\s|-|[.?:;,()\\!\\&\\"\'^_*~]|$)';
        return [ shellWordSeparatorStart, shellWordSeparatorEnd ];
    }

    protected createRegex (searchBarValue: string, useRegex: boolean, wholeWord: boolean): RegExp {
        let regexSource = searchBarValue;
        if (!useRegex) {
            regexSource = regexSource.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        if (wholeWord) {
            const [shellWordSeparatorStart, shellWordSeparatorEnd ] = this.getWordSeparators();
            regexSource = `${shellWordSeparatorStart}${regexSource}${shellWordSeparatorEnd}`;
        }

        return new RegExp(regexSource);
    }

    protected transformLine (line: string): string {
        return line;
    }

    static runningGreps: Record<number, childProcess.ChildProcessWithoutNullStreams> = [];
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
    
        // Output of a git grep command is of this format:
        // URI:ONE_INDEXED_LINE:CONTENTS_OF_LINE
        // This is not particularly helpful to us because if we want to generate vscode.Location objects
        //      we are missing the start and end range of the matched text
        // This function mainly exists to process the raw output of a git grep command output and 
        //      transform it into vscode.Location so it can be used elsewhere in the writing environment
    
        const regex = this.createRegex(searchBarValue, useRegex, wholeWord);
    
        try {
            // Call git grep
            const ps = childProcess.spawn(this.name, this.getCommand(regex.source, caseInsensitive), {
                cwd: extension.rootPath.fsPath
            });
    
    
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
            
            // Any "finished" operation for the grep command should reset the git state back to its original
            // Iterate over lines from the stdout of the git grep command and yield each line provided to us
            for await (const line of readline.createInterface({ input: ps.stdout })) {
                if (cancelled) return null;
                yield this.transformLine(line);
            }
    
            if (ps.pid && ps.pid in Grepper.runningGreps) {
                delete Grepper.runningGreps[ps.pid];
            }
        }
        catch (err: any) {
            vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}' regex.  Error: ${err}`);
            return null;
        }
    }

    validateGrepper (grepperGetter: CmdLineSearch) {
        try {
            childProcess.execSync(`${grepperGetter} ${this.name}`);
            console.log(`Using grepper [${this.name}]`);
            return true;
        }
        catch (err: any) {
            return false;
        }
    }
}
