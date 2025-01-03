import * as vscode from 'vscode';
import * as extension from './../extension';
import { FragmentNode, OutlineNode } from "../outline/nodes_impl/outlineNode";
import { ScratchPadView } from "./scratchPadView";
import { determineAuxViewColumn, getLatestOrdering, readDotConfig, writeDotConfig } from '../miscTools/help';
import { getUsableFileName } from '../outline/impl/createNodes';
import { TabLabels } from '../tabLabels/tabLabels';

export async function newScratchPadFile (
    this: ScratchPadView, 
): Promise<vscode.Uri | null> {

    // First scan all existing scratch pad documents
    // If there exists any scratch pad document with all whitespace or an empty file entirely, then
    //      open that document
    let replace: vscode.Uri | null = null;
    for (const scratch of this.rootNodes) {
        const buff = await vscode.workspace.fs.readFile(scratch.data.ids.uri);
        const content = extension.decoder.decode(buff);
        if (/^\s*$/.test(content)) {
            replace = scratch.data.ids.uri;
            break;
        }
    }
    
    let showUri: vscode.Uri;
    if (!replace) {
        const fileName = getUsableFileName('fragment', true);
    
        const parentDotConfig = await readDotConfig(ScratchPadView.scratchPadConfigUri);
        if (!parentDotConfig) return null;
    
        // Get the fragment number for this fragment
        const latestFragmentNumber = getLatestOrdering(parentDotConfig);
        const newFragmentNumber = latestFragmentNumber + 1;
    
        const title = `Scratch Pad ${newFragmentNumber}`;
    
        // Write the fragment file
        const fragmentUri = vscode.Uri.joinPath(ScratchPadView.scratchPadContainerUri, fileName);
        const fragment: FragmentNode = {
            ids: {
                display: title,
                fileName: fileName,
                ordering: newFragmentNumber,
                parentTypeId: 'snip',
                parentUri: ScratchPadView.scratchPadContainerUri,
                type: 'fragment',
                relativePath: '/',
                uri: fragmentUri
            },
            md: ''
        };
    
        // Add snip node to parent node's content array
        const fragmentNode = new OutlineNode(fragment);
        this.rootNodes.push(fragmentNode);
    
        parentDotConfig[fileName] = {
            ordering: newFragmentNumber,
            title: title
        }
    
        try {
            await vscode.workspace.fs.writeFile(fragmentUri, new Uint8Array());
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error creating new fragment file: ${e}.`);
        }
        await writeDotConfig(ScratchPadView.scratchPadConfigUri, parentDotConfig);

        showUri = fragmentUri;
    }
    else showUri = replace;

    vscode.window.showTextDocument(showUri, {
        viewColumn: await determineAuxViewColumn((uri) => this.getTreeElementByUri(uri))
    }).then(() => {
        TabLabels.assignNamesForOpenTabs();
    });
    this.refresh(false, [])
    return showUri;
}