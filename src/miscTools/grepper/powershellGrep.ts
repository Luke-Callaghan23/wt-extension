import { Grepper } from './grepper';

export class PowershellGrep extends Grepper {

    protected get name(): string {
        return 'powershell.exe';
    }

    protected getCommand(regexSource: string, caseInsensitive: boolean): string[] {
        const caseSensitive: string[] | string = !caseInsensitive
            ? '-CaseSensitive'
            : [];

        const source = regexSource.replaceAll('\\"', '`"');
        return [ 'get-childitem', '-Recurse', '-Include', '"*.wtnote",', '"*.wt",', '"*.config"', '|', 'select-string', '-Pattern', `"${source}"`, caseSensitive, "|", "foreach", "{", '"$_"', "}"].flat();;
    }
}