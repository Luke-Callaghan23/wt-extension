import { window } from 'vscode';
const channel = window.createOutputChannel('WTLog');

export const log = (p: Object | string | null | undefined) => {
    if (p === undefined) {
        channel.appendLine('undefined');
    }
    else if (p === null) {
        channel.appendLine('null');
    }
    else if (typeof p === 'string') {
        channel.appendLine(p as string);
    }
    else {
        channel.appendLine(JSON.stringify(p, null, 2));
    }
};