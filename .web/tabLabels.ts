import * as vscode from 'vscode';
import { ConfigurationTarget, workspace } from 'vscode';
import * as console from './../vsconsole'
import { OutlineView } from '../outline/outlineView';
import * as extension from './../extension';
import { RecyclingBinView } from '../recyclingBin/recyclingBinView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { Ids } from '../outlineProvider/fsNodes';

export class TabLabels {
    private static outlineView: OutlineView;
    private static recylingBinView: RecyclingBinView;

    constructor (outlineView: OutlineView, recyclingBinView: RecyclingBinView) {
        TabLabels.outlineView = outlineView;
        TabLabels.recylingBinView = recyclingBinView;
        this.registerCommands();
    }

    private registerCommands() {

        const renameFromUri = async (uri: vscode.Uri) => {
            // Look in outline view
            let node: { data: { ids: Ids } } | null = await TabLabels.outlineView.getTreeElementByUri(uri);
            // Look in recycling bin view
            if (!node) node = await TabLabels.recylingBinView.getTreeElementByUri(uri);

            // If not found in either give an error message
            if (!node) {
                vscode.window.showErrorMessage("[ERROR] Could not find selected item within Writing Tool's scope.  Please only use this command on .wt files within this project.");
                return;
            }

            const outlineNode = node as OutlineNode;
            TabLabels.outlineView.renameResource(outlineNode);
        }

        vscode.commands.registerCommand("wt.tabLabels.rename", async (uri: vscode.Uri) => {            
            return renameFromUri(uri);
        });
        vscode.commands.registerCommand("wt.tabLabels.renameActiveTab", async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const uri = editor.document.uri;
            return renameFromUri(uri);
        });
    }

    static async assignNamesForOpenTabs () {


        const configuration = workspace.getConfiguration();
        configuration.update('workbench.editor.customLabels.enabled', true, ConfigurationTarget.Workspace);
    
        const newPatterns: { [index: string]: string } = {};
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (!(tab.input instanceof vscode.TabInputText)) continue;
    
                const uri = tab.input.uri;
                if (!uri.fsPath.endsWith('.wt')) continue;
    
                let foundInRecycling = false;

                // First look for the node in the outline view
                let node: { data: { ids: Ids } } | null = await TabLabels.outlineView.getTreeElementByUri(uri);
                if (!node) {
                    // Then look in the recycling bin view
                    node = await TabLabels.recylingBinView.getTreeElementByUri(uri);
                    if (!node) continue;
                    foundInRecycling = true;
                }
    
                // Remove the extension root path from the pattern
                let relativePath = uri.fsPath.replaceAll(extension.rootPath.fsPath, '').replaceAll('\\', '/')
                if (relativePath.startsWith('/')) {
                    relativePath = relativePath.substring(1);
                }
    
                // If the node was found in the recycling bin, mark it as deleted in the label so the user knows
                newPatterns[relativePath] = foundInRecycling
                    ? `(deleted) ${node.data.ids.display}`
                    : node.data.ids.display;
            }
        }
    
        const oldPatterns: { [index: string]: string} = await configuration.get('workbench.editor.customLabels.patterns') || {};
        const combinedPatterns = { ...oldPatterns, ...newPatterns };

        const maxTabLabel = configuration.get<number>('wt.tabLabels.maxSize');

        const finalPatterns: { [index: string]: string } = {};
        const set = new Set<string>();
        Object.entries(combinedPatterns).forEach(([ pattern, label ]) => {
            let finalLabel = label;
            let index = 0;
            while (set.has(finalLabel)) {
                finalLabel = `${label} [${index}]`
                index++;
            }
            set.add(finalLabel);
            const finalPattern = pattern.startsWith('*/')
                ? pattern
                : `*/${pattern}`;
            finalPatterns[finalPattern] = maxTabLabel && maxTabLabel > 3 && finalLabel.length > maxTabLabel-3
                ? finalLabel.substring(0, maxTabLabel-3) + "...'"
                : finalLabel;
        });

        return configuration.update('workbench.editor.customLabels.patterns', finalPatterns, ConfigurationTarget.Workspace);
    }
    
    
    static async clearNamesForAllTabs () {
        const configuration = workspace.getConfiguration();
        configuration.update('workbench.editor.customLabels.enabled', true, ConfigurationTarget.Workspace);
    
        
        const oldPatterns: { [index: string]: string } = await configuration.get('workbench.editor.customLabels.patterns') || {};
        const filteredPatterns: { [index: string]: string } = {};
        for (const [ pattern, value ] of Object.entries(oldPatterns)) {
            if (pattern.endsWith('.wt')) continue;
            filteredPatterns[pattern] = value;
        }
    
        return configuration.update('workbench.editor.customLabels.patterns', filteredPatterns, ConfigurationTarget.Workspace);
    }
}
