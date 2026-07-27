import * as vscode from 'vscode';
import * as console from '../vsconsole';
import * as childProcess from 'child_process';
import { Extension } from   '../../extension';
import { getBinPath, binName } from "vscode-ripgrep-utils";
import { buildMarkdownIgnoringRegex } from './common';
import { getRelativePath, statFile } from '../help';
import { nodeGrep, nodeGrepExtensionDirectory } from './nodeGrep';


export type GrepResult = {
    status: 'success',
    lines: string[]
} | {
    status: 'error',
    message: string
};

type StateQueryablePromise <T> = Promise<T> & { status: ()=>"pending" | "fulfilled" | "rejected" };

function makeQueryablePromise <T> (promise: Promise<T>): StateQueryablePromise<T> {
    let isPending = true;
    let isRejected = false;
    let isFulfilled = false;

    // Observe the promise to update status flags
    const result = promise.then(
        (value) => {
            isFulfilled = true;
            isPending = false;
            return value;
        },
        (error) => {
            isRejected = true;
            isPending = false;
            throw error;
        }
    ) as StateQueryablePromise<T>;

    // Expose status-checking methods
    result.status = () => {
        if (isPending) return "pending";
        if (isFulfilled) return "fulfilled";
        return "rejected";
    };

    return result;
}


export function getRipGrepBinarySearchPromise (context: vscode.ExtensionContext): StateQueryablePromise<string> {


    async function confirmRgPath (path: string | undefined): Promise<string | null> {
        if (path) {
            const statResult = await statFile(vscode.Uri.file(path));

            // Check exists
            if (!statResult) {
                vscode.window.showWarningMessage(`[WARN] RipGrep location specified in [settings](command:workbench.action.openSettings?%22wt.wtSearch.ripGrepLocation%22) '${path}' could not be found.  Searching for rg binary in VSCode distribution instead.`);
            }
            // Check if it's a file
            else if (statResult.type !== vscode.FileType.File) {
                vscode.window.showWarningMessage(`[WARN] RipGrep location specified in [settings](command:workbench.action.openSettings?%22wt.wtSearch.ripGrepLocation%22) '${path}' could was not a static file.  Searching for rg binary in VSCode distribution instead..`);
            }
            // Do a basic sanity check on the binary to make sure that the --version command returns the text "ripgrep" somewhere in its result
            else {
                // Run --version command
                const versionResult = new Promise<void>((resolve, reject) => {
                    const ps = childProcess.spawnSync(path, ["--version"]);

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
                        reject(message);
                        return;
                    }

                    const containsString = ps.output
                        .filter(data=>data && data.length)
                        .toString()
                        .toLocaleLowerCase()
                        .includes('ripgrep');

                    if (containsString) {
                        resolve();
                    }
                    else {
                        reject(`Output did not include the text 'ripgrep'.  Output was stdout='${ps.output}', stderr='${ps.error}'`);
                    }
                });

                try {
                    // Await the execution of the process above.  If it is not rejected, then the rg binary appears to be okay.  We can use the path.
                    await versionResult;
                    return path;
                }
                catch (err) {
                    vscode.window.showWarningMessage(`[WARN] RipGrep location specified in [settings](command:workbench.action.openSettings?%22wt.wtSearch.ripGrepLocation%22) '${path}' did not return expected output.  Message: ${err}`);
                }
            }
        }

        return null;
    }
    
    const rgBinPromise = (async (): Promise<string> => {
        
        console.log("[RG SEARCH] ================================");
        console.log("[RG SEARCH] Starting rg bin search")

        // First, see if the user has provided a 'rg' binary location in the configuration 'wt.wtSearch.ripGrepLocation'
        const configuration = vscode.workspace.getConfiguration();
        const configRipGrep: string | undefined = configuration.get<string>('wt.wtSearch.ripGrepLocation');

        console.log(`[RG SEARCH] configRipGrep: ${configRipGrep}`);

        const crg = await confirmRgPath(configRipGrep);

        console.log(`[RG SEARCH] result: ${crg}`);

        if (crg) {
            return crg;
        }
        
        // Second, check if there is a cached ripgrep location in the workspace state
        const workspaceStateRg: string | undefined = context.workspaceState.get<string>("wt.wtSearch.ripGrepLocation");

        console.log(`[RG SEARCH] workspaceStateRg: ${workspaceStateRg}`);

        const wsrg = await confirmRgPath(workspaceStateRg);
        console.log(`[RG SEARCH] result: ${wsrg}`);

        if (wsrg) {
            return wsrg;
        }

        console.log(`[RG SEARCH] searching getBinPath`);

        // If none of the above cached paths work, use the vscode-ripgrep-utils module to automatically search the VS Code distributable for rg 
        //      in a few set locations
        const rgBinPath = await getBinPath(vscode.env.appRoot);
        if (rgBinPath) {
            console.log(`[RG SEARCH] Found rg at '${rgBinPath}'!`);
            return rgBinPath;
        }

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

        // If the set loctions returned nothing, do a broader search of the VS Code distribution folder

        // First do a targeted search at the last known MS distribution path for rg
        
        // ripgrep bin seems to have moved, and `vscode-ripgrep-utils` hasn't been updated yet
        // Search manually
        // Still keep `vscode-ripgrep-utils` around for legacy support :)
        const ripgrepUniversal = vscode.Uri.joinPath (
            vscode.Uri.file(vscode.env.appRoot),
            "node_modules/@vscode/ripgrep-universal/bin"
        );

        if (await statFile(ripgrepUniversal)) {
            console.log(`[RG SEARCH] searching ${ripgrepUniversal}`);
    
            const targetedSearch = await searchPath(ripgrepUniversal);
            if (targetedSearch !== null) {
                console.log(`[RG SEARCH] Found rg at '${targetedSearch.fsPath}'!`);
                return targetedSearch.fsPath;
            }
        }


        // Do another targeted search inside of node_modules.asar.unpacked
        const asarUnpacked = vscode.Uri.joinPath (
            vscode.Uri.file(vscode.env.appRoot),
            "node_modules.asar.unpacked/@vscode/ripgrep-universal/bin"
        );

        if (await statFile(asarUnpacked)) {
            console.log(`[RG SEARCH] searching ${asarUnpacked}`);
    
            const asarUnpackedSearch = await searchPath(asarUnpacked);
            if (asarUnpackedSearch !== null) {
                console.log(`[RG SEARCH] Found rg at '${asarUnpacked.fsPath}'!`);
                return asarUnpackedSearch.fsPath;
            }
        }

        // Otherwise, do a long search on the entire node_modules directory
        const nodeModules = vscode.Uri.file(vscode.env.appRoot);
        
        if (await statFile(nodeModules)) {
            console.log(`[RG SEARCH] searching ${nodeModules}`);
            
            const nodeModuleSearch = await searchPath(nodeModules);
            if (nodeModuleSearch !== null) {
                console.log(`[RG SEARCH] Found rg at '${nodeModuleSearch.fsPath}'!`);
                return nodeModuleSearch.fsPath;
            }
        }

        console.log("[RG SEARCH] Could not find path!!!");
        throw "Could not find ripgrep!";
    })()
    .then((result) => {
        console.log(`[RG SEARCH] Found path '${result}'`);
        if (result !== null && !context.workspaceState.get("wt.wtSearch.ripGrepLocation")) {
            vscode.window.showInformationMessage(`[INFO] Storing 'rg' location '${result}' in workspace state.`)
            context.workspaceState.update("wt.wtSearch.ripGrepLocation", result);
        }
        return result;
    });

    return makeQueryablePromise(rgBinPromise);
}

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

    // Use the initial rg search
    public static rgPath: StateQueryablePromise<string>;

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

            let caseFlag: string;
            if (useCaseInsensitive) {
                caseFlag = '-i';
            }
            else {
                caseFlag = '-s';
            }

            const command = ['--only-matching', '--column', '--no-heading', '--with-filename', '-.', '-n', caseFlag, regex.source, overrideFilter || './'];
            
            console.log(`[INFO] Running grep command 'rg' with args: "${command.join('" "')}"`);

            const status = RipGrep.rgPath.status();
            if (status === 'rejected') {
                vscode.window.showWarningMessage("[WARN] Could not find RipGrep binary location in VSCode distribution. You can also manually set the RipGrep location in [settings](command:workbench.action.openSettings?%22wt.wtSearch.ripGrepLocation%22) or by running [this command](command:wt.wtSearch.setRipGrepLocation). For now, a slower search will be performed using the VSCode API");
                return nodeGrepExtensionDirectory(searchBarValue, useRegex, useCaseInsensitive, useWholeWord, cancellationToken).then(res => {
                    if (!res) {
                        return {
                            status: 'error',
                            message: 'Node grep failed'
                        };
                    }

                    // Unfortunately, for convenience, we'll need to re-convert the results of nodeGrepExtensionDirectory back into rg formatted lines
                    return {
                        status: "success",
                        lines: res.map(([ loc, matchedText ]) => {
                            const relativePath = getRelativePath(loc.uri);
                            return `${relativePath}:${loc.range.start.line+1}:${loc.range.start.character+1}:${matchedText}`;
                        })
                    }
                });
            }
            else if (status === 'pending') {
                vscode.window.showWarningMessage("[WARN] Still searching for RipGrep binary location in vscode distribution folder! Search will continue after it is located. You can also manually set the RipGrep location in [settings](command:workbench.action.openSettings?%22wt.wtSearch.ripGrepLocation%22) or by running [this command](command:wt.wtSearch.setRipGrepLocation).");
            }

            const rgPath = await RipGrep.rgPath;
            const ps = childProcess.spawnSync(rgPath, command, {
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

    static async init (context: vscode.ExtensionContext) {
        RipGrep.rgPath = getRipGrepBinarySearchPromise(context);
    }
}