import { Grepper } from './grepper';

export class RipGrep extends Grepper {

    protected get name(): string {
        return 'rg';
    }

    protected getCommand(regexSource: string, caseInsensitive: boolean): string[] {
        let flags = '-n';
        if (caseInsensitive) {
            flags += 'i';
        }

        return ['--no-heading', flags, regexSource, './']
    }

    protected getWordSeparators (): [string, string] {
        const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()!&"\'^_*~])';
        const shellWordSeparatorEnd = '(\\s|-|[.?:;,()!&"\'^_*~]|$)';
        return [ shellWordSeparatorStart, shellWordSeparatorEnd ]
    }
}