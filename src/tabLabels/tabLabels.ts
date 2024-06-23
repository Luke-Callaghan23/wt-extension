import * as vscode from 'vscode';
import { ConfigurationTarget, workspace } from 'vscode';
import * as console from './../vsconsole'
import { OutlineView } from '../outline/outlineView';
import * as extension from './../extension';
import { RecyclingBinView, Renamable } from '../recyclingBin/recyclingBinView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { Ids } from '../outlineProvider/fsNodes';
import { CodeModeState } from '../codeMode/codeMode';
import { ScratchPadView } from '../scratchPad/scratchPadView';
import { WorkBible } from '../workBible/workBible';
import { vagueNodeSearch } from '../help';

export class TabLabels {
    private static outlineView: OutlineView;
    private static recyclingBinView: RecyclingBinView;
    private static scratchPadView: ScratchPadView;
    private static workBible: WorkBible;

    public static enabled: boolean = true;
    constructor (outlineView: OutlineView, recyclingBinView: RecyclingBinView, scratchPadView: ScratchPadView, workBible: WorkBible) {
        TabLabels.outlineView = outlineView;
        TabLabels.recyclingBinView = recyclingBinView;
        TabLabels.scratchPadView = scratchPadView;
        TabLabels.workBible = workBible;
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
        if (!TabLabels.enabled) return;
        const codeModeState: CodeModeState = await vscode.commands.executeCommand('wt.codeMode.getMode');
        if (codeModeState === 'codeMode') return;

        const configuration = workspace.getConfiguration();
        configuration.update('workbench.editor.customLabels.enabled', true, ConfigurationTarget.Workspace);
    
        const newPatterns: { [index: string]: string } = {};
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (!(tab.input instanceof vscode.TabInputText)) continue;
    
                const uri = tab.input.uri;
                if (!(uri.fsPath.endsWith('.wt') || uri.fsPath.endsWith('.wtnote'))) continue;

                console.log(`Tab labels: inspecting ${uri.fsPath}`);

                const { node: nodeOrNote, source } = await vagueNodeSearch(uri, TabLabels.outlineView, TabLabels.recyclingBinView, TabLabels.scratchPadView, TabLabels.workBible);
                console.log(`Tab labels for ${uri.fsPath}:\n  node=${nodeOrNote}\n  source='${source}'`);
                if (!nodeOrNote || !source) continue;

                const node: { data: { ids: { display: string } } } = nodeOrNote instanceof OutlineNode ?
                    nodeOrNote : { data: { ids: { display: nodeOrNote.noun } } };
    
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
                else if (source === 'workBible') {
                    label = `(notes) ${node.data.ids.display}`;
                }
                else throw 'unreachable';
                console.log(`Tab labels for ${uri.fsPath}: label='${label}'`);
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
