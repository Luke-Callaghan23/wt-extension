import * as vscode from 'vscode';
import { ConfigurationTarget, workspace } from 'vscode';
import * as console from './../vsconsole'
import { OutlineView } from '../outline/outlineView';
import * as extension from './../extension';
import { RecyclingBinView, Renamable } from '../recyclingBin/recyclingBinView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { Ids } from '../outlineProvider/fsNodes';
import { ScratchPadView } from '../scratchPad/scratchPadView';

export class TabLabels {
    private static outlineView: OutlineView;
    private static recyclingBinView: RecyclingBinView;
    private static scratchPadView: ScratchPadView;

    constructor (outlineView: OutlineView, recyclingBinView: RecyclingBinView, scratchPadView: ScratchPadView) {
        TabLabels.outlineView = outlineView;
        TabLabels.recyclingBinView = recyclingBinView;
        TabLabels.scratchPadView = scratchPadView;
        this.registerCommands();

        vscode.workspace.onDidChangeConfiguration((e) => {
            const configuration = 'wt.tabLabels.maxSize';
            if (!e.affectsConfiguration(configuration)) return;
            TabLabels.assignNamesForOpenTabs();
        });
    }

    private registerCommands() {

        const renameFromUri = async (uri: vscode.Uri) => {
            type ViewSource = Renamable<OutlineNode>;
            let nodeResult: [ ViewSource, OutlineNode ]
            try {
                nodeResult = await Promise.any([
                    new Promise<[ ViewSource, OutlineNode ]>((resolve, reject) => TabLabels.outlineView.getTreeElementByUri(uri).then(node => node ? resolve([ TabLabels.outlineView, node ]) : reject())),
                    new Promise<[ ViewSource, OutlineNode ]>((resolve, reject) =>  TabLabels.recyclingBinView.getTreeElementByUri(uri).then(node => node ? resolve([ TabLabels.recyclingBinView, node ]) : reject())),
                    new Promise<[ ViewSource, OutlineNode ]>((resolve, reject) =>  TabLabels.scratchPadView.getTreeElementByUri(uri).then(node => node ? resolve([ TabLabels.scratchPadView, node ]) : reject())),
                ]);
            }
            catch (err: any) {
                vscode.window.showErrorMessage("[ERROR] Could not find selected item within Writing Tool's scope.  Please only use this command on .wt files within this project.");
                return;
            }

            const [ source, node ] = nodeResult;
            return source.renameResource(node);
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
    
                let source: 'outline' | 'recycle' | 'scratch' = 'outline';

                // First look for the node in the outline view
                let node: { data: { ids: Ids } } | null = await TabLabels.outlineView.getTreeElementByUri(uri);

                if (!node) {
                    // Then look in the recycling bin view
                    node = await TabLabels.recyclingBinView.getTreeElementByUri(uri);
                    if (node) source = 'recycle';
                }
                if (!node) {
                    // Then look in the recycling bin view
                    node = await TabLabels.scratchPadView.getTreeElementByUri(uri);
                    if (!node) continue;
                    source = 'scratch';
                }
    
                // Remove the extension root path from the pattern
                let relativePath = uri.fsPath.replaceAll(extension.rootPath.fsPath, '').replaceAll('\\', '/')
                if (relativePath.startsWith('/')) {
                    relativePath = relativePath.substring(1);
                }
    
                // If the node was found in the recycling bin, mark it as deleted in the label so the user knows
                let label: string;
                if (source === 'outline') {
                    label = node.data.ids.display;
                }
                else if (source === 'recycle') {
                    label = `(deleted) ${node.data.ids.display}`;
                }
                else if (source === 'scratch') {
                    if (/Scratch Pad \d+/i.test(node.data.ids.display)) {
                        label = node.data.ids.display;
                    }
                    else {
                        label = `(scratch) ${node.data.ids.display}`;
                    }
                }
                else throw 'unreachable';
                newPatterns['*/' + relativePath] = label;
            }
        }
        
        const maxTabLabel = configuration.get<number>('wt.tabLabels.maxSize');

        const finalPatterns: { [index: string]: string } = {};
        const set = new Set<string>();
        Object.entries(newPatterns).forEach(([ pattern, label ]) => {
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
            finalPatterns[finalPattern] = maxTabLabel && maxTabLabel > 3 && finalLabel.length > maxTabLabel
                ? finalLabel.substring(0, maxTabLabel) + "..."
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
