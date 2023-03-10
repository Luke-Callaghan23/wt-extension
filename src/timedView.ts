import { throws } from 'assert';
import * as vscode from 'vscode';
import { Packageable } from './packageable';

export interface Timed {
    enabled: boolean;
    update(editor: vscode.TextEditor): Promise<void>;
    disable?(): Promise<void>;
}

export class TimedView implements Packageable {
    private activeEditor: vscode.TextEditor | undefined;

    constructor (
        private context: vscode.ExtensionContext,
        private timedViews: [string, Timed][]
    ) {
        // If there is an active editor, then trigger decarator updates off the bat
        this.activeEditor = vscode.window.activeTextEditor;
        if (this.activeEditor) {
            this.triggerUpdates();
        }
    
        // If the active editor changed, then change the internal activeEditor value and trigger updates
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.activeEditor = editor;
            if (editor) {
                this.triggerUpdates();
            }
        }, null, context.subscriptions);
    
        // On text document change within the editor, update decorations with throttle
        vscode.workspace.onDidChangeTextDocument(event => {
            if (this.activeEditor && event.document === this.activeEditor.document) {
                this.triggerUpdates(true);
            }
        }, null, context.subscriptions);

        
        // Get the initial 'enabled' state for each of the timed views from the workspace context 
        // These variables are either initially house inside of vscode natively, or they're 
        //      injected into the context in 'loadWorkspace' or 'importWorkspace'
        this.timedViews.forEach(([ viewName, timed ]) => {
            // Read raw value from workspace state -- could be undefined
            const contextEnabled: boolean | undefined = context.workspaceState.get(`${viewName}.enabled`);

            // If there is no existing value from the workspace for enabled, just make it initially
            //      enabled by default
            const enabled = contextEnabled === undefined ? true : contextEnabled;
            vscode.commands.executeCommand(`setContext`, `${viewName}.enabled`, enabled);
            timed.enabled = enabled;
        })

        this.registerCommands();
    }

    private doUpdates (editor: vscode.TextEditor) {
        // Only do updates on .wt files
        if (!editor.document.fileName.endsWith('.wt')) return;
        // Iterate over all timed views and call their update functions if they're enabled
        this.timedViews.forEach(([ _, timed ]) => {
            // If the view's timer function is not enabled, then skip
            if (!timed.enabled) return;
            timed.update(editor);
        })
    }
    
    private timeout: NodeJS.Timer | undefined = undefined;
	private triggerUpdates(throttle: boolean = false) {
        if (!this.activeEditor) return;
        const editor: vscode.TextEditor = this.activeEditor;

        // Clear timeout if it exists
        // This is the 'throttling' part of the function
        // If there was a throttled call to triggerUpdates in the last 500 ms, then
        //      clear that timer (preventing the call), and use the timer generated 
        //      in this call instead
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }

        // If this call is throttled, use a timeout to call the update function
        if (throttle) {
            this.timeout = setTimeout(() => this.doUpdates(editor), 500);
        } 
        else {
            this.doUpdates(editor);
        }
	}

    private registerCommands () {
        this.timedViews.forEach(([ viewName, timed ]) => {
            vscode.commands.registerCommand(`${viewName}.enable`, () => {
                vscode.commands.executeCommand(`setContext`, `${viewName}.enabled`, true);
                this.context.workspaceState.update(`${viewName}.enabled`, true);
                timed.enabled = true;
                // Draw decorations
                if (this.activeEditor) {
                    timed.update(this.activeEditor);
                }
            });
    
            vscode.commands.registerCommand(`${viewName}.disable`, () => {
                vscode.commands.executeCommand(`setContext`, `${viewName}.enabled`, false);
                this.context.workspaceState.update(`${viewName}.enabled`, false);
                timed.enabled = false;
    
                // Clear decorations
                timed.disable?.();
            });
        })
    }
    
    getPackageItems(): { [index: string]: any; } {
        const packaged: { [index: string]: any } = {};

        // Iterate over all timed views to collect their paclage items
        this.timedViews.forEach(([ viewName, timed ]) => {
            // Every timed item has a context value for whether or not its timed
            //      update function was enabled at the time of packing
            // Add it to the packaged map
            packaged[`${viewName}.enabled`] = timed.enabled;

            // If the timed view itself implements Packageable, then get those
            //      packaged items, and pack them as well
            if ('getPackageItems' in timed) {
                const packagedItems = (timed as Packageable).getPackageItems();
                Object.entries(packagedItems).forEach(([ contextKey, contextValue ]) => {
                    packaged[contextKey] = contextValue;
                });
            }
        });

        // Return all packaged items for all timed views
        return packaged;
    }
}