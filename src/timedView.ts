import * as vscode from 'vscode';
import { createPackageItems, Packageable } from './packageable';
import * as console from './miscTools/vsconsole';

export interface Timed {
    enabled: boolean;
    update(editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void>;
    disable?(): Promise<void>;
}

export class TimedView implements Packageable<any> {
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
            setTimeout(() => {
                this.triggerUpdates();
            }, 0);
        }, null, context.subscriptions));
    
        // On text document change within the editor, update decorations with throttle
        this.context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
            this.triggerUpdates(true);
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
                        const commentedRanges = TimedView.findCommentedRanges(editor);
                        timed.update(editor, commentedRanges);
                    }
                }
                else {
                    vscode.commands.executeCommand(`setContext`, `${viewName}.enabled`, false);
                    this.context.workspaceState.update(`${viewName}.enabled`, false);
                    timed.enabled = false;
        
                    // Clear decorations
                    timed.disable?.();
                }
            });
        }));

        this.registerCommands();
        this.triggerUpdates();
    }

    private static commentRegex = /(?<comment>\[.*\])+/g;
    public static findCommentedRanges (editor: vscode.TextEditor): vscode.Range[] {
        const text = editor.document.getText();
        const commentedRanges: vscode.Range[] = [];
        let m;
        while ((m = TimedView.commentRegex.exec(text)) !== null) {
            const match: RegExpExecArray = m;
            commentedRanges.push(new vscode.Range(
                editor.document.positionAt(match.index),
                editor.document.positionAt(match.index + match[0].length - 1)
            ))
        }
        return commentedRanges;
    }

    private doUpdates (editor: vscode.TextEditor, uncommentedRanges: vscode.Range[]) {
        // Only do updates on .wt files
        if (
            !editor.document.fileName.toLocaleLowerCase().endsWith('.wt') && 
            !editor.document.fileName.toLocaleLowerCase().endsWith('.wtnote')
        ) return;
        // Iterate over all timed views and call their update functions if they're enabled
        this.timedViews.forEach(([ id, viewId, timed ]) => {
            console.log(`UPDATE: ${id} (${timed.enabled ? 'enabled' : 'disabled'})`);
            // If the view's timer function is not enabled, then skip
            if (!timed.enabled) return;
            timed.update(editor, uncommentedRanges);
        })
    }
    
    private timeout: NodeJS.Timer | undefined = undefined;
	private triggerUpdates(throttle: boolean = false) {

        // Clear timeout if it exists
        // This is the 'throttling' part of the function
        // If there was a throttled call to triggerUpdates in the last 500 ms, then
        //      clear that timer (preventing the call), and use the timer generated 
        //      in this call instead
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
        
        this.timeout = setTimeout(() => {
            for (const editor of vscode.window.visibleTextEditors) {
                const commentedRanges = TimedView.findCommentedRanges(editor);
        
                // If this call is throttled, use a timeout to call the update function
                if (throttle) {
                    try {
                        this.doUpdates(editor, commentedRanges);
                    }
                    catch (err: any) {}
                } 
                else {
                    this.doUpdates(editor, commentedRanges);
                }
            }
        }, 250);
	}

    private registerCommands () {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.timedViews.update', () => this.triggerUpdates(true)));
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