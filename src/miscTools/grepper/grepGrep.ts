import { Grepper } from './grepper';

export class GrepGrep extends Grepper {

    protected get name(): string {
        return 'grep';
    }

    protected getCommand(regexSource: string, caseInsensitive: boolean, overrideFilter?: string): string[] {
        let flags = '-r';
        if (caseInsensitive) {
            flags += 'i';
        }

        return [flags, '-H', '-n', '-E', '--include', '*.config', '--include', '*.wt', '--include', '*.wtnote', regexSource, overrideFilter || './'];
    }
}