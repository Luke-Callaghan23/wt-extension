import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import { RipGrep } from './ripGrep';
import { GrepGrep } from './grepGrep';
import { PowershellGrep } from './powershellGrep';
import { GitGrep } from './gitGrep';
import * as extension from './../../extension';
import * as readline from 'readline';

export type CmdLineSearch = 'get-command' | 'where' | 'which';

export type GrepResult = {
    status: 'success',
    lines: string[]
} | {
    status: 'error',
    message: string
};

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
    public async query (
        searchBarValue: string, 
        useRegex: boolean, 
        caseInsensitive: boolean, 
        wholeWord: boolean, 
        cancellationToken: vscode.CancellationToken
    ): Promise<GrepResult> {
        // Output of a git grep command is of this format:
        // URI:ONE_INDEXED_LINE:CONTENTS_OF_LINE
        // This is not particularly helpful to us because if we want to generate vscode.Location objects
        //      we are missing the start and end range of the matched text
        // This function mainly exists to process the raw output of a git grep command output and 
        //      transform it into vscode.Location so it can be used elsewhere in the writing environment
    
        const regex = this.createRegex(searchBarValue, useRegex, wholeWord);
        try {
            // Call git grep
            const command = this.getCommand(regex.source, caseInsensitive);
            const ps = childProcess.spawnSync(this.name, command, {
                cwd: extension.rootPath.fsPath
            });

            if (!ps.output || ps.error) {
                const stderr = ps.stderr.toString();
                const error = ps.error?.message;

                let message;
                if (stderr && error) {
                    message = `${error} -- ${stderr}`
                }
                else if (stderr) {
                    message = stderr;
                }
                else if (error) {
                    message = error;
                }
                else {
                    message = 'Unknown error';
                }

                return {
                    status: 'error',
                    message: `Unable to search because an error occured while running '${this.name}': ${message}`
                }
            }

            return {
                status: 'success',
                lines: ps.output
                    .toString()
                    .split('\n')
                    .map(line => this.transformLine(line))
            }
        }
        catch (err: any) {
            vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}'.  Error: ${err}`);
            return {
                status: 'error',
                message: `Unable to search because an error occured while running '${this.name}': ${err}`
            };
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
