import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import { findGitGrep, gitGrep } from './gitGrep';
import { findRipGrep  } from './ripGrep';
import { findGrepGrep  } from './grepGrep';
import { findPowershellGrep } from './powershellGrep';


// A GREPPER MUST RECIEVE A REGEX AND RETURN A GENERATOR THAT YIELDS LINES FORMATTED LIKE:
//      path_to_file:1-indexed_line_of_result:contents_of_the_line
export type Grepper = (
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
    cancellationToken: vscode.CancellationToken
) => AsyncGenerator<string | null>;

export type FindMyGrepper = (grepperGetter: GrepperGetter) => Grepper | null;
export type GrepperGetter = 'get-command' | 'where' | 'which';

const registeredGreppersInOrderOfPreference: FindMyGrepper[] = [
    findRipGrep,
    findGrepGrep,
    findPowershellGrep,
    findGitGrep,
]

function getGrepperGetter (): GrepperGetter | null {
    try {
        childProcess.execSync('get-command git');
        return 'get-command';
    }
    catch (err: any) {}
    try {
        childProcess.execSync('where git');
        return 'where';
    }
    catch (err: any) {}
    try {
        childProcess.execSync('which git');
        return 'which';
    }
    catch (err: any) {}
    return null;
}

function showMeUrGreppers (): Grepper {
    const grepperGetter = getGrepperGetter();
    if (!grepperGetter) {
        return gitGrep;
    }

    for (const getGrepper of registeredGreppersInOrderOfPreference) {
        const grepper = getGrepper(grepperGetter);
        if (grepper) {
            return grepper;
        }
    }
    return gitGrep;
}


export const grepper = showMeUrGreppers();
