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
            newPatterns[uri.fsPath] = (node as OutlineNode).data.ids.display
        }
    }

    const oldPatterns: { [index: string]: string} = await configuration.get('workbench.editor.customLabels.patterns') || {};
    const combinedPatterns = { ...oldPatterns, ...newPatterns };

    const finalPatterns: { [index: string]: string } = {};
    for (const [ name, val ] of  Object.entries(combinedPatterns)) {
        finalPatterns[name.replaceAll(extension.rootPath.fsPath, '').replaceAll('\\', '/').substring(1)] = val;
    }
    return configuration.update('workbench.editor.customLabels.patterns', finalPatterns, ConfigurationTarget.Workspace);
}
