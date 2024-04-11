import * as vscode from 'vscode';
import { ConfigurationTarget, workspace } from 'vscode';
import * as console from './../vsconsole'
import { OutlineView } from '../outline/outlineView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import * as extension from './../extension';

export const assignNamesForOpenTabs = async (outline: OutlineView) => {
    const configuration = workspace.getConfiguration();
    configuration.update('workbench.editor.customLabels.enabled', true, ConfigurationTarget.Workspace);

    const newPatterns: { [index: string]: string } = {};
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (!(tab.input instanceof vscode.TabInputText)) continue;

            const uri = tab.input.uri;
            if (!uri.fsPath.endsWith('.wt')) continue;

            const node = await outline.getTreeElementByUri(uri);

            // Remove the extension root path from the pattern
            let relativePath = uri.fsPath.replaceAll(extension.rootPath.fsPath, '').replaceAll('\\', '/')
            if (relativePath.startsWith('/')) {
                relativePath = relativePath.substring(1);
            }

            newPatterns[relativePath] = (node as OutlineNode).data.ids.display;
        }
    }

    const oldPatterns: { [index: string]: string} = await configuration.get('workbench.editor.customLabels.patterns') || {};
    const combinedPatterns = { ...oldPatterns, ...newPatterns };
    return configuration.update('workbench.editor.customLabels.patterns', combinedPatterns, ConfigurationTarget.Workspace);
}


export const clearNamesForAllTabs = async () => {
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