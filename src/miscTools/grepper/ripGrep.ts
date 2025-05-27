import * as vscode from 'vscode';
import * as extension from '../../extension';
import * as readline from 'readline';
import * as childProcess from 'child_process';
import { Grepper, GrepperGetter } from './findMyGrepper';

export async function *ripGrep (
    regex: RegExp,
): AsyncGenerator<string | null> {
    try {
        // Call git grep
        const ps = childProcess.spawn(`rg`, ['--no-heading', regex.source], {
            cwd: extension.rootPath.fsPath
        })

        
        // Any "finished" operation for the grep command should reset the git state back to its original
        .addListener('close', (l) => {
            console.log('close');
            console.log('close');
            console.log('close');
            console.log('close');
            console.log('close');
            console.log('close');
            console.log('close');
            console.log('close');
            console.log('close');
            console.log(l);
        })
        .addListener('disconnect', () => {
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('dc');
        })
        .addListener('exit', (l) => {
            console.log('exit');
            console.log('exit');
            console.log('exit');
            console.log('exit');
            console.log('exit');
            console.log('exit');
            console.log('exit');
            console.log('exit');
            console.log('exit');
            console.log(l);
        })
        .addListener("error", (error: Error) => {
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
            console.log(error);
        })
        .addListener('disconnect', () => {
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
            console.log('disconnect');
        })
        .addListener('message', () => {
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
            console.log('message');
        })
        .addListener('spawn', () => {
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
            console.log('spawn')
        });



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

export function findRipGrep (grepperGetter: GrepperGetter): Grepper | null {
    try {
        childProcess.execSync(`${grepperGetter} rg`);
        console.log('Using grepper [rg]');
        return null;
    }
    catch (err: any) {
        return null;
    }
}