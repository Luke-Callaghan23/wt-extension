import * as vscode from 'vscode';
import { createPackageItems, Packageable } from './packageable';
import * as console from './miscTools/vsconsole';

export interface Timed {
    enabled: boolean;
    getUpdatesAreVisible(): boolean;
    update(editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void>;
    disable?(): Promise<void>;
}

export class TimedView implements Packageable<any> {
    private scheduledUpdates = new Map<string, ReturnType<typeof setTimeout>>();
    private pendingEditors = new Map<string, Set<vscode.TextEditor>>();
    private queuedEditors = new Map<string, Set<vscode.TextEditor>>();
    private processingUpdates = false;

    constructor (
        private context: vscode.ExtensionContext,
        private timedViews: [string, string, Timed ][]
    ) {

        // Get the initial 'enabled' state for each of the timed views from the workspace context 
        // These variables are either initially house inside of vscode natively, or they're 
        //      injected into the context in 'loadWorkspace' or 'importWorkspace'
        this.timedViews.forEach(([ viewName, viewId, timed ]) => {
            
            // Read the value from of the setting for this timed view from the settings
            const settingsEnabled = vscode.workspace.getConfiguration(`wt.timedSearches`);
            const enabled = settingsEnabled
                ? !!settingsEnabled.get<boolean>(viewId)
                : true;

            vscode.commands.executeCommand(`setContext`, `${viewName}.enabled`, enabled);
            timed.enabled = enabled;
        });

        // If the active editor changed, then change the internal activeEditor value and trigger updates
        this.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            // Let VS Code finish switching editors before scheduling decoration updates.
            setTimeout(() => {
                if (editor) this.scheduleEditorUpdate(editor);
            }, 0);
        }, null, context.subscriptions));
    
        // On text document change within the editor, update decorations with throttle
        this.context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
            // Update every visible editor showing the changed document.
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document === event.document) this.scheduleEditorUpdate(editor);
            }
        }, null, context.subscriptions));


        this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
            this.timedViews.forEach(([ viewName, viewId, timed ]) => {
                const configuration = `wt.timedSearches.${viewId}`;
                if (!e.affectsConfiguration(configuration)) return;

                const settingsEnabled = vscode.workspace.getConfiguration(`wt.timedSearches`);
                const enabled = settingsEnabled
                    ? !!settingsEnabled.get<boolean>(viewId)
                    : true;

                if (enabled) {
                    vscode.commands.executeCommand(`setContext`, `${viewName}.enabled`, true);
                    this.context.workspaceState.update(`${viewName}.enabled`, true);
                    timed.enabled = true;
                    
                    for (const editor of vscode.window.visibleTextEditors) {
                        this.scheduleEditorUpdate(editor);
                    }
                }
                else {
                    vscode.commands.executeCommand(`setContext`, `${viewName}.enabled`, false);
                    this.context.workspaceState.update(`${viewName}.enabled`, false);
                    timed.enabled = false;
        
                    // Clear decorations when the setting disables this view.
                    void timed.disable?.().catch(err => {
                        console.log(`[ERR] Failed to disable timed view '${viewName}': ${err}`);
                    });
                }
            });
        }));

        this.registerCommands();
        this.context.subscriptions.push(new vscode.Disposable(() => this.dispose()));
        for (const editor of vscode.window.visibleTextEditors) this.scheduleEditorUpdate(editor);
    }

    public static findCommentedRanges (editor: vscode.TextEditor): vscode.Range[] {
        const text = editor.document.getText();
        const commentedRanges: vscode.Range[] = [];
        const commentRegex = /(?<comment>\[.*\])+/g;
        let m;
        while ((m = commentRegex.exec(text)) !== null) {
            const match: RegExpExecArray = m;
            commentedRanges.push(new vscode.Range(
                editor.document.positionAt(match.index),
                editor.document.positionAt(match.index + match[0].length - 1)
            ))
        }
        return commentedRanges;
    }

    private async doUpdates (editor: vscode.TextEditor, uncommentedRanges: vscode.Range[]): Promise<void> {
        if (!this.isSupportedDocument(editor.document)) return;

        // Iterate over all timed views and call their update functions if they're enabled
        for (const [id, _viewId, timed] of this.timedViews) {
            // If the view's timer function is not enabled, then skip
            if (!timed.enabled || !timed.getUpdatesAreVisible()) continue;
            try {
                await timed.update(editor, uncommentedRanges);
            }
            catch (err: any) {
                console.log(`[ERR] Timed view '${id}' failed to update: ${err}`);
            }
        }
    }

    private scheduleEditorUpdate (editor: vscode.TextEditor): void {
        if (!this.isSupportedDocument(editor.document)) return;

        // group editors by document so split views share one debounce timer
        const documentKey = editor.document.uri.toString();
        const editors = this.pendingEditors.get(documentKey) || new Set<vscode.TextEditor>();
        editors.add(editor);
        this.pendingEditors.set(documentKey, editors);

        const existingTimeout = this.scheduledUpdates.get(documentKey);
        if (existingTimeout) clearTimeout(existingTimeout);

        this.scheduledUpdates.set(documentKey, setTimeout(() => {
            this.scheduledUpdates.delete(documentKey);
            // move this batch to the queue before starting asynchronous updates
            const readyEditors = this.pendingEditors.get(documentKey);
            if (readyEditors) {
                this.pendingEditors.delete(documentKey);
                this.queuedEditors.set(documentKey, readyEditors);
            }
            void this.processPendingUpdates();
        }, 250));
    }

    private isSupportedDocument (document: vscode.TextDocument): boolean {
        const fileName = document.fileName.toLocaleLowerCase();
        return fileName.endsWith('.wt') || fileName.endsWith('.wtnote') || fileName.endsWith('.md');
    }

    private async processPendingUpdates (): Promise<void> {
        if (this.processingUpdates) return;
        this.processingUpdates = true;

        try {
            while (this.queuedEditors.size > 0) {
                const batches = [...this.queuedEditors.entries()];
                this.queuedEditors.clear();
                // process documents concurrently, but update each editor serially
                await Promise.all(batches.map(async ([, editors]) => {
                    for (const editor of editors) {
                        // closed editors no longer need decorations
                        if (!vscode.window.visibleTextEditors.includes(editor)) continue;
                        const commentedRanges = TimedView.findCommentedRanges(editor);
                        await this.doUpdates(editor, commentedRanges);
                    }
                }));
            }
        }
        finally {
            this.processingUpdates = false;
            // drain updates queued during the final await
            if (this.queuedEditors.size > 0) void this.processPendingUpdates();
        }
    }

    private dispose (): void {
        for (const timeout of this.scheduledUpdates.values()) clearTimeout(timeout);
        this.scheduledUpdates.clear();
        this.pendingEditors.clear();
        this.queuedEditors.clear();
    }

    public updateTimedViews (): void {
        for (const editor of vscode.window.visibleTextEditors) this.scheduleEditorUpdate(editor);
    }

    private registerCommands () {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.timedViews.update', this.updateTimedViews.bind(this)));
    }
    
    getPackageItems(): { [index: string]: any; } {
        const packaged: { [index: string]: any } = {};

        // Iterate over all timed views to collect their paclage items
        this.timedViews.forEach(([ viewName, viewId, timed ]) => {
            // Every timed item has a context value for whether or not its timed
            //      update function was enabled at the time of packing
            // Add it to the packaged map
            packaged[`${viewName}.enabled`] = timed.enabled;

            // If the timed view itself implements Packageable, then get those
            //      packaged items, and pack them as well
            if ('getPackageItems' in timed) {
                const packagedItems = (timed as Packageable<any>).getPackageItems(createPackageItems);
                Object.entries(packagedItems).forEach(([ contextKey, contextValue ]) => {
                    packaged[contextKey] = contextValue;
                });
            }
        });

        // Return all packaged items for all timed views
        return packaged;
    }
}