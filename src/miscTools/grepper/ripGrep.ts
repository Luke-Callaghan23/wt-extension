import * as vscode from 'vscode';
import * as console from '../vsconsole';
import * as childProcess from 'child_process';
import { Extension } from   '../../extension';
import { getBinPath, binName } from "vscode-ripgrep-utils";
import { buildMarkdownIgnoringRegex } from './common';


export type GrepResult = {
    status: 'success',
    lines: string[]
} | {
    status: 'error',
    message: string
};


let finalRgPath: string | null = null;
getBinPath(vscode.env.appRoot).then(async (rgBinPath) => {
    if (rgBinPath) {
        finalRgPath = rgBinPath;
    }

    // ripgrep bin seems to have moved, and `vscode-ripgrep-utils` hasn't been updated yet
    // Search manually
    // Still keep `vscode-ripgrep-utils` around for legacy support :)
    if (!rgBinPath) {
        const ripgrepUniversal = vscode.Uri.joinPath (
            vscode.Uri.file(vscode.env.appRoot),
            "node_modules/@vscode/ripgrep-universal/bin"
        );
    
        // Recursive search for `binName` file
        async function searchPath (path: vscode.Uri): Promise<vscode.Uri | null> {
            const promises: Promise<vscode.Uri | null>[] = [];
            for (const [ fn, fileType ] of await vscode.workspace.fs.readDirectory(path)) {
                const next = vscode.Uri.joinPath(path, fn);
                if (fileType === vscode.FileType.File) {
                    if (fn === binName) {
                        return next;
                    }
                }
                else if (fileType === vscode.FileType.Directory) {
                    promises.push(searchPath(next));
                }
            }

            const searches = await Promise.all(promises);
            for (const result of searches) {
                if (result === null) continue;
                return result;
            }
            return null;
        }

        const searched = await searchPath(ripgrepUniversal);
        if (searched !== null) {
            finalRgPath = searched.fsPath;
        }
    }
})

export class RipGrep {

    private static createRegex (searchBarValue: string, useRegex: boolean, useWholeWord: boolean, useIgnoreStyleCharacters: boolean): RegExp {
        let regexSource = searchBarValue;
        if (!useRegex) {
            if (useIgnoreStyleCharacters) {
                regexSource = buildMarkdownIgnoringRegex(regexSource);
            }
            else {
                regexSource = regexSource.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
        }

        if (useWholeWord) {
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
        useCaseInsensitive: boolean, 
        useWholeWord: boolean, 
        useIgnoreStyleCharacters: boolean,
        cancellationToken: vscode.CancellationToken,
        overrideFilter?: string,
    ): Promise<GrepResult> {
        // Output of a git grep command is of this format:
        // URI:ONE_INDEXED_LINE:CONTENTS_OF_LINE
        // This is not particularly helpful to us because if we want to generate vscode.Location objects
        //      we are missing the start and end range of the matched text
        // This function mainly exists to process the raw output of a git grep command output and 
        //      transform it into vscode.Location so it can be used elsewhere in the writing environment
    
        const regex = RipGrep.createRegex(searchBarValue, useRegex, useWholeWord, useIgnoreStyleCharacters);
        try {
            // Call git grep

            let flags = '-n';
            if (useCaseInsensitive) {
                flags += 'i';
            }
            const command = ['--no-heading', '--with-filename', '-.', flags, regex.source, overrideFilter || './'];
            
            console.log(`[INFO] Running grep command 'rg' with args: "${command.join('" "')}"`)
            
            if (!finalRgPath) {
                throw "Could not find ripgrep!";
            }
            const ps = childProcess.spawnSync(finalRgPath, command, {
                cwd: Extension.rootPath.fsPath,
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
