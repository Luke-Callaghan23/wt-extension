/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as console from '../../vsconsole';
import { Config, Workspace } from '../workspace';
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from '../../panels/treeViews/outline/outlineNodes';
import { OutlineView } from '../../panels/treeViews/outline/outlineView';
import { ChaptersRecord, FragmentRecord, SnipsRecord, WorkspaceExport as WorkspaceRecord } from './types';


async function recordFragmentContainer (node: (ChapterNode | SnipNode)): Promise<FragmentRecord> {
    // Read and sort fragment data from container
    const fragments = node.textData;
    fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

    // Read all the fragments from dist
    const fragmentBuffers: Buffer[] = await Promise.all(fragments.map(fragment => {
        return fs.promises.readFile(fragment.getUri());
    }));

    // Pair sorted fragments with their data buffers
    const record: FragmentRecord = [];
    for (let i = 0; i < fragments.length; i++) {
        const fragment = fragments[i];
        const markdown = fragmentBuffers[i];
        record.push({
            title: fragment.data.ids.display,
            markdown: markdown.toString()
        });
    }

    // Add record for this node to the map
    return record;
}


async function recordSnipsContainer (container: ContainerNode): Promise<SnipsRecord> {
    const snips: SnipsRecord = [];
    for (const content of container.contents) {
        const snipNode = content.data as SnipNode;
        const fragementsRecord = await recordFragmentContainer(snipNode);
        snips.push({
            title: snipNode.ids.display,
            fragments: fragementsRecord
        });
    }
    return snips;
}


async function recordChaptersContainer (container: ContainerNode): Promise<ChaptersRecord> {
    const chaptersRecord: ChaptersRecord = [];
    for (const content of container.contents) {
        const chapterNode = content.data as ChapterNode;
        const fragementsRecord = await recordFragmentContainer(chapterNode);
        const snipsRecord = await recordSnipsContainer(chapterNode.snips.data as ContainerNode);
        chaptersRecord.push({
            title: chapterNode.ids.display,
            fragments: fragementsRecord,
            snips: snipsRecord,
        });
    }
    return chaptersRecord;
}

async function getIweFileName (
    workspace: Workspace
): Promise<string> {
    // Read the entries of the export folder
    const exportFolder = workspace.exportFolder;
    const entries = await fs.promises.readdir(exportFolder, { withFileTypes: true });

    // Keep only those entries with names that match the export file pattern:
    //      wt( \(\d+\))?.iwe
    // Pattern explanation: accepts names like: 'wt.iwe', or 'wt (#).iwe', where # is a positive whole number
    const iweEntries = entries.filter(entry => {
        if (entry.isDirectory()) return false;
        return /wt( \(\d+\))?.iwe/.test(entry.name);
    });

    // If no other iwe entries, then file name is wt.iwe
    if (iweEntries.length === 0) return 'wt.iwe';
    // If there is only one entry and that entry is wt.iwe, then the next one is wt (1).iwe
    if (iweEntries.length === 1 && iweEntries[0].name === 'wt.iwe') return 'wt (1).iwe';

    const inParens: (string | undefined)[] = iweEntries.map(entry => {
        return /wt( \((?<duplicate>\d+)\))?.iwe/.exec(entry.name)?.groups?.duplicate;
    });

    // Remove 'wt.iwe' (wt.iwe is undefined in the inParens array, because the group (?<duplicate>\d+) was never matched)
    const numStrings: string[] = inParens.filter(numOrUndefined => numOrUndefined !== undefined) as any[];
    const nums: number[] = numStrings.map(n => parseInt(n));

    let next = 1;
    while (next <= nums.length) {
        if (!nums.find(n => n === next)) {
            // If the next index is not in the nums array already then use next
            break;
        }
        next++;
    }

    // Return the file name
    return `wt (${next}).iwe`;
}


export async function handleWorkspaceExport (
    _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    workspace: Workspace,
    outlineView: OutlineView
) {
    const root: RootNode = outlineView.tree.data as RootNode;
    const chaptersContainer: ContainerNode = root.chapters.data as ContainerNode;
    const snipsContainer: ContainerNode = root.snips.data as ContainerNode;

    // Record the chapters and snips containers
    const chaptersRecord: ChaptersRecord = await recordChaptersContainer(chaptersContainer);
    const snipsRecord: SnipsRecord = await recordSnipsContainer(snipsContainer);

    // Create the iwe object
    const iwe = {
        config: workspace.config,
        chapters: chaptersRecord,
        snips: snipsRecord
    } as WorkspaceRecord;

    // Write the workspace to disk
    const iweJSON = JSON.stringify(iwe, null, 2);
    const iweFilename = await getIweFileName(workspace);
    const iweFullpath = `${workspace.exportFolder}/${iweFilename}`;
    await fs.promises.writeFile(iweFullpath, iweJSON);
    vscode.window.showInformationMessage(`Successfully created file '${iweFilename}' in '${workspace.exportFolder}'`);
}