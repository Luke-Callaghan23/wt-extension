import * as vscode from 'vscode';
import * as extension from '../../extension';
import * as readline from 'readline';
import * as childProcess from 'child_process';
import { Grepper, GrepperGetter } from './findMyGrepper';

export async function *powershellGrep (
    regex: RegExp,
): AsyncGenerator<string | null> {
    try {
        const source = regex.source.replaceAll('\\"', '`"')

        // Call git grep
        const ps = childProcess.spawn('powershell.exe', [ 'get-childitem', '-Recurse', '-Include', '"*.wtnote",', '"*.wt",', '"*.config"', '|', 'select-string', '-Pattern', `"${source}"`, "|", "foreach", "{", '"$_"', "}"], {
            cwd: extension.rootPath.fsPath
        });
        // Any "finished" operation for the grep command should reset the git state back to its original
        // Iterate over lines from the stdout of the git grep command and yield each line provided to us
        for await (const line of readline.createInterface({ input: ps.stdout })) {
            yield line.toLocaleLowerCase().replaceAll(extension.rootPath.fsPath.toLocaleLowerCase(), '');
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