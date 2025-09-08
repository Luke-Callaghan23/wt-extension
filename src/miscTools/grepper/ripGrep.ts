import * as vscode from 'vscode';
import * as console from '../vsconsole';
import * as childProcess from 'child_process';
import * as extension from '../../extension';
import { getBinPath } from "vscode-ripgrep-utils";


export type GrepResult = {
    status: 'success',
    lines: string[]
} | {
    status: 'error',
    message: string
};

export class RipGrep {

    private static createRegex (searchBarValue: string, useRegex: boolean, wholeWord: boolean): RegExp {
        let regexSource = searchBarValue;
        if (!useRegex) {
            regexSource = regexSource.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        if (wholeWord) {
            const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()!&"\'^_*~])';
            const shellWordSeparatorEnd = '(\\s|-|[.?:;,()!&"\'^_*~]|$)';
            regexSource = `${shellWordSeparatorStart}${regexSource}${shellWordSeparatorEnd}`;
        }

        return new RegExp(regexSource);
    }

    private static transformLine (line: string): string {
        return line.replace(/^,/, '');
    }

    static runningGreps: Record<number, childProcess.ChildProcessWithoutNullStreams> = [];
    public static async query (
        searchBarValue: string, 
        useRegex: boolean, 
        caseInsensitive: boolean, 
        wholeWord: boolean, 
        cancellationToken: vscode.CancellationToken,
        overrideFilter?: string,
    ): Promise<GrepResult> {
        // Output of a git grep command is of this format:
        // URI:ONE_INDEXED_LINE:CONTENTS_OF_LINE
        // This is not particularly helpful to us because if we want to generate vscode.Location objects
        //      we are missing the start and end range of the matched text
        // This function mainly exists to process the raw output of a git grep command output and 
        //      transform it into vscode.Location so it can be used elsewhere in the writing environment
    
        const regex = RipGrep.createRegex(searchBarValue, useRegex, wholeWord);
        try {
            // Call git grep

            let flags = '-n';
            if (caseInsensitive) {
                flags += 'i';
            }
            const command = ['--no-heading', '--with-filename', '-.', flags, searchBarValue, overrideFilter || './'];
            
            console.log(`[INFO] Running grep command 'rg' with args: "${command.join('" "')}"`)
            
            const rgBinPath = await getBinPath(vscode.env.appRoot);
            if (!rgBinPath) throw "Error executing 'rg'";
            const ps = childProcess.spawnSync(rgBinPath, command, {
                cwd: extension.rootPath.fsPath,
                maxBuffer: 1024 * 1024 * 50                 // 50 MB max buffer
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
                    message: `Unable to search because an error occured while running 'rg': ${message}`
                }
            }

            return {
                status: 'success',
                lines: ps.output
                    .filter(data=>data && data.length)
                    .toString()
                    .split('\n')
                    .map(line => this.transformLine(line))
            }
        }
        catch (err: any) {
            vscode.window.showErrorMessage(`Failed to search local directories for '${regex.source}'.  Error: ${err}`);
            return {
                status: 'error',
                message: `Unable to search because an error occured while running 'rg': ${err}`
            };
        }
    }
}
