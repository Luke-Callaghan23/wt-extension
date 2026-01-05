/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { compareFsPath, ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../../miscTools/help';
import * as console from '../../miscTools/vsconsole';
import { OutlineView } from '../outlineView';
import { OutlineNode, SnipNode } from '../nodes_impl/outlineNode';
import * as extension from '../../extension';
import { TabLabels } from '../../tabLabels/tabLabels';
import { TODOsView } from '../../TODO/TODOsView';
import { TODONode } from '../../TODO/node';
import { getUsableFileName } from './createNodes';

async function updateDescription (
    resource: OutlineNode,
    newDescriprion: string,
) {
    lastDescriptionUpdatedNode = resource;
    
    const relativePath = resource.data.ids.relativePath;
    const fileName = resource.data.ids.fileName;
    const displayName = resource.data.ids.display;

    const fullPath = vscode.Uri.joinPath(extension.rootPath, relativePath, fileName);

    const dotConfigUri = vscodeUris.Utils.joinPath(resource.data.ids.parentUri, '.config');
    if (!dotConfigUri) {
        vscode.window.showErrorMessage(`Unable to find configuration file for resource: '${fullPath}'`);
        return;
    }

    const dotConfig = await readDotConfig(dotConfigUri);
    if (!dotConfig) return;

    // Make updates to the .config file
    if (!dotConfig[fileName]) {
        // If we couldn't find the item in .config, then create a default entry for it
        dotConfig[fileName] = {
            title: displayName,
            description: newDescriprion,
            ordering: getLatestOrdering(dotConfig) + 1
        };
    }
    else {
        // Update the description
        dotConfig[fileName].description = newDescriprion;
    }

    // Re-write the config object to the file system
    await writeDotConfig(dotConfigUri, dotConfig);

    // Update internal outline tree structure's name
    resource.data.ids.description = newDescriprion;
    
    vscode.window.showInformationMessage(`Successfully updated '${displayName}' description to '${newDescriprion}'`);
    await extension.ExtensionGlobals.outlineView.refresh(false, [resource], true);
}

let lastDescriptionUpdatedNode: OutlineNode | undefined;
export async function editNodeDescription (this: OutlineView, overrideNode?: OutlineNode, overrideDescription?: string) {

    const resource: OutlineNode | undefined = overrideNode || this.view.selection[0] || lastDescriptionUpdatedNode;
    if (!resource) return;
    lastDescriptionUpdatedNode = resource;
    
    const displayName = resource.data.ids.display;
    const type = resource.data.ids.type;
    
    const originalDescription = resource.data.ids.description || "";
    const newDescriprion = overrideDescription || await vscode.window.showInputBox({
        placeHolder: originalDescription,
        prompt: `Add a description for ${type} '${displayName}'? (markdown styling can apply)`,
        ignoreFocusOut: false,
        value: originalDescription,
        valueSelection: [0, originalDescription.length]
    });
    if (!newDescriprion) return;
    return updateDescription(resource, newDescriprion);
}


export async function editNodeMarkdownDescription (this: OutlineView, overrideNode?: OutlineNode, overrideRename?: string) {
    const resource: OutlineNode | undefined = overrideNode || this.view.selection[0] || lastDescriptionUpdatedNode;
    if (!resource) return;
    lastDescriptionUpdatedNode = resource;

    const existingDescription: string | undefined = resource.data.ids.description;
    for await (const descriptionMd of yieldMarkdownDescription(resource.data.ids.display, existingDescription)) {
        if (descriptionMd === null) continue;
        await updateDescription(resource, descriptionMd.value);
    }
}


export async function* yieldMarkdownDescription (displayName: string, initialDescription: string | undefined): AsyncGenerator<vscode.MarkdownString | null> {
    const currentDescription = initialDescription || "";

    const tmpFolder = vscode.Uri.joinPath(extension.rootPath, 'tmp');
    try {
        await vscode.workspace.fs.createDirectory(tmpFolder);
    }
    catch (err: any) {}

    const descriptionFN = `${getUsableFileName('descriptionMarkdown')}.wt`;
    const descriptionUri = vscode.Uri.joinPath(extension.rootPath, 'tmp', descriptionFN);
    const contentBuff = extension.encoder.encode(currentDescription);
    await vscode.workspace.fs.writeFile(descriptionUri, contentBuff);
    
    await vscode.window.showTextDocument(descriptionUri, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
    });
    TabLabels.setTmpLabel(descriptionFN, `Edit Description Markdown (for '${displayName}')`);
    await TabLabels.assignNamesForOpenTabs();

    let stop = false;
    while (!stop) {
        const response = await new Promise<vscode.MarkdownString | null>(async (accept, reject) => {
            const dispose1 = vscode.workspace.onDidCloseTextDocument(async e => {
                dispose1.dispose();
                dispose2.dispose();
                
                // Only listening for the closure of description file
                const uri = e.uri.fsPath.replaceAll(".git", "");
                if (uri !== descriptionUri.fsPath) return;

                const buf = await vscode.workspace.fs.readFile(descriptionUri);
                const content = extension.decoder.decode(buf);
                stop = true;
                accept(new vscode.MarkdownString(content));
            });
            const dispose2 = vscode.workspace.onDidSaveTextDocument(async e => {
                dispose1.dispose();
                dispose2.dispose();

                // Only listening for update to the description file
                const uri = e.uri.fsPath.replaceAll(".git", "");
                if (uri !== descriptionUri.fsPath) return;

                const buf = await vscode.workspace.fs.readFile(descriptionUri);
                const content = extension.decoder.decode(buf);
                accept(new vscode.MarkdownString(content));
            });

            // After five minute, dispose everything and accept nothing
            setTimeout(() => {
                dispose1.dispose();
                dispose2.dispose();
                for (const group of vscode.window.tabGroups.all) {
                    const descriptionUriTabIndex = group.tabs.findIndex(tab => {
                        return tab.input instanceof vscode.TabInputText && (
                            compareFsPath(tab.input.uri, descriptionUri)
                        )
                    });
                    if (descriptionUriTabIndex === -1) continue;

                    // Close the description tab
                    const tab = group.tabs[descriptionUriTabIndex];
                    vscode.window.tabGroups.close(tab);
                    break;
                }
                stop = true;
                accept(null);
            }, 5 * 60 * 1000);
        });

        yield response;
    }
}