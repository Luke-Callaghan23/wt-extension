import * as vscode from 'vscode';

export const DEFAULT_DEBOUNCE_TIMER_MS = 20;

export abstract class BounceOnIt <Args extends unknown[]> {

    constructor (private debounceTime: number = DEFAULT_DEBOUNCE_TIMER_MS) {}

    protected abstract debouncedUpdate(cancellationToken: vscode.CancellationToken, ...arg: Args): Promise<void>;
    
    private debounce: NodeJS.Timeout | null = null;
    protected async triggerDebounce  (...args: Args): Promise<void> {
        this.cancelTokens();

        this.debounce && clearTimeout(this.debounce);
        this.debounce = setTimeout(async () => {
            const customCancellationToken: vscode.CancellationTokenSource | null = new vscode.CancellationTokenSource();
            this.tokens.push(customCancellationToken);
            this.debouncedUpdate(customCancellationToken.token, ...args);
        }, this.debounceTime);
    }

    private tokens: vscode.CancellationTokenSource[] = [];
    protected cancelTokens () {
        for (const tok of this.tokens) {
            try {
                tok.cancel();
                tok.dispose();
            }
            catch (err: any) {}
        }
    }
}