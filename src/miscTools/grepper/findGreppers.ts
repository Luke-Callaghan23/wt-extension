import * as childProcess from 'child_process';
import { CmdLineSearch, Grepper } from "./grepper";
import { GitGrep } from './gitGrep';
import { RipGrep } from './ripGrep';
import { GrepGrep } from './grepGrep';
import { PowershellGrep } from './powershellGrep';

export function showMeUrGreppers (): Grepper {

    let commandLineSearch: CmdLineSearch | null = null;
    try {
        childProcess.execSync('get-command git');
        commandLineSearch = 'get-command';
    }
    catch (err: any) {}
    try {
        childProcess.execSync('where git');
        commandLineSearch = 'where';
    }
    catch (err: any) {}
    try {
        childProcess.execSync('which git');
        commandLineSearch = 'which';
    }
    catch (err: any) {}

    const gitGrep = new GitGrep();
    if (!commandLineSearch) {
        return gitGrep;
    }

    const registeredGreppersInOrderOfPreference: Grepper[] = [
        // new RipGrep(),
        new GrepGrep(),
        new PowershellGrep(),
    ];

    for (const grepper of registeredGreppersInOrderOfPreference) {
        if (grepper.validateGrepper(commandLineSearch)) {
            return grepper;
        }
    }
    return gitGrep;
}