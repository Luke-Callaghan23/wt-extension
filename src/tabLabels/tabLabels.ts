import * as vscode from 'vscode';
import { ConfigurationTarget, workspace } from 'vscode';
import * as console from './../vsconsole'
import { OutlineView } from '../outline/outlineView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';

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
            newPatterns[uri.fsPath] = (node as OutlineNode).data.ids.display
        }
    }

    const oldPatterns: { [index: string]: string} = await configuration.get('workbench.editor.customLabels.patterns') || {};
    const finalPatterns = { ...oldPatterns, ...newPatterns };
    return configuration.update('workbench.editor.customLabels.patterns', finalPatterns, ConfigurationTarget.Workspace);
}
