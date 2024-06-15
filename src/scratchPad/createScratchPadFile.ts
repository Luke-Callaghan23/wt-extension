import * as vscode from 'vscode';
import { FragmentNode, OutlineNode } from "../outline/nodes_impl/outlineNode";
import { ScratchPadView } from "./scratchPadView";
import { getLatestOrdering, readDotConfig, writeDotConfig } from '../help';
import { getUsableFileName } from '../outline/impl/createNodes';

export async function newScratchPadFile (
    this: ScratchPadView, 
): Promise<vscode.Uri | null> {
    const fileName = getUsableFileName('fragment', true);

    const parentDotConfig = await readDotConfig(ScratchPadView.scratchPadConfigUri);
    if (!parentDotConfig) return null;

    // Get the fragment number for this fragment
    const latestFragmentNumber = getLatestOrdering(parentDotConfig);
    const newFragmentNumber = latestFragmentNumber + 1;

    const title = `Scratch Pad ${newFragmentNumber}`;

    // Write the fragment file
    const fragmentUri = vscode.Uri.joinPath(ScratchPadView.scratchPadContainerUri, fileName);
    const fragment = <FragmentNode> {
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

    vscode.window.showTextDocument(fragmentUri);
    this.refresh(false, []);
    return fragmentNode.getUri();
}