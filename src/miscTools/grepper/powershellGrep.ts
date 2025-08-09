import * as extension from './../../extension'
import { Grepper } from './grepper';

export class PowershellGrep extends Grepper {

    protected get name(): string {
        return 'powershell.exe';
    }

    protected getCommand(regexSource: string, caseInsensitive: boolean, overrideFilter?: string): string[] {
        const caseSensitive: string[] | string = !caseInsensitive
            ? '-CaseSensitive'
            : [];

        const override: string[] = overrideFilter
            ? [ '-Path', overrideFilter ]
            : []

        const source = regexSource.replaceAll('\\"', '`"');
        return [ 'get-childitem', override, '-Recurse', '-Include', '"*.wtnote",', '"*.wt",', '"*.config"', '|', 'select-string', '-Pattern', `"${source}"`, caseSensitive, "|", "foreach", "{", '"$_"', "}"].flat();
    }

    protected transformLine(line: string): string {
        return line.toLocaleLowerCase().replaceAll(extension.rootPath.fsPath.toLocaleLowerCase(), '');
    }
}