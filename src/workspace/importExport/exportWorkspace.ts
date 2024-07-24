/* eslint-disable curly */
import * as vscode from 'vscode';
import * as extension from './../../extension';
import * as console from '../../miscTools/vsconsole';
import { Workspace } from '../workspaceClass';
import { ChapterNode, ContainerNode, FragmentNode, OutlineNode, RootNode, SnipNode } from '../../outline/nodes_impl/outlineNode';
import { OutlineView } from '../../outline/outlineView';
import { ChaptersRecord, FragmentRecord, FragmentsExport, SnipsExport, SnipsRecord, WorkspaceExport as WorkspaceRecord } from './types';
import { Buff } from '../../Buffer/bufferSource';

type FragmentsExportPromise = {
    title: string,
    markdownPromise: Thenable<Uint8Array>
}

async function recordSnipData (node: SnipNode): Promise<SnipsExport> {
    const sortedContent = node.contents.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);



    const outputPromises: (FragmentsExportPromise | Thenable<SnipsExport>)[] = [];
    for (const content of sortedContent) {
        if (content.data.ids.type === 'snip') {
            const out = recordSnipData(content.data as SnipNode);
            outputPromises.push(out);
        }
        else if (content.data.ids.type === 'fragment') {
            const fragment = content.data as FragmentNode;
            const out: FragmentsExportPromise = {
                title: fragment.ids.display,
                markdownPromise: vscode.workspace.fs.readFile(content.getUri())
            };
            outputPromises.push(out);
        }
    }


    // Await all of the promises created above
    const output: (FragmentsExport | SnipsExport)[] = await Promise.all<FragmentsExport | SnipsExport>(outputPromises.map(op => {
        return new Promise((resolve, reject) => {
            if ('title' in  op) {
                // If 'title' field is in the object we know it's a fragments export promise
                // Once the file read is finised, decode the markdown content and return a FragmentsExport
                op.markdownPromise.then(mdArray => {
                    resolve({
                        title: op.title,
                        markdown: extension.decoder.decode(mdArray)
                    });
                });
            }
            else {
                // If there is no 'title' field, it's an unresolve SnipsExport
                // Once the snip finishes resolving, then resolve this promise with that export
                op.then(resolve);
            }
        });
    }));

    return {
        title: node.ids.display,
        contents: output
    }
}

async function recordChapterFragmentContainer (node: ChapterNode): Promise<FragmentRecord> {
    // Read and sort fragment data from container
    const fragments = node.textData;
    fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

    // Read all the fragments from dist
    const fragmentBuffers: Uint8Array[] = await Promise.all(fragments.map(fragment => {
        return vscode.workspace.fs.readFile(fragment.getUri());
    }));

    // Pair sorted fragments with their data buffers
    const record: FragmentRecord = [];
    for (let i = 0; i < fragments.length; i++) {
        const fragment = fragments[i];
        const markdown = fragmentBuffers[i];
        record.push({
            title: fragment.data.ids.display,
            markdown: extension.decoder.decode(markdown)
        });
    }

    // Add record for this node to the map
    return record;
}


async function recordSnipsContainer (container: ContainerNode): Promise<SnipsRecord> {
    const snips: SnipsRecord = [];
    for (const content of container.contents) {
        const snipNode = content.data as SnipNode;
        snips.push(await recordSnipData(snipNode));
    }
    return snips;
}


async function recordChaptersContainer (container: ContainerNode): Promise<ChaptersRecord> {
    const chaptersRecord: ChaptersRecord = [];
    for (const content of container.contents) {
        const chapterNode = content.data as ChapterNode;
        const fragementsRecord = await recordChapterFragmentContainer(chapterNode);
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
    const exportUri = workspace.exportFolder;
    const entries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(exportUri);

    // Keep only those entries with names that match the export file pattern:
    //      wt( \(\d+\))?.iwe
    // Pattern explanation: accepts names like: 'wt.iwe', or 'wt (#).iwe', where # is a positive whole number
    const iweEntries = entries.filter(([ name, fileType ]) => {
        if (fileType === vscode.FileType.Directory) return false;
        return /wt( \(\d+\))?.iwe/.test(name);
    });

    // If no other iwe entries, then file name is wt.iwe
    if (iweEntries.length === 0) return 'wt.iwe';
    // If there is only one entry and that entry is wt.iwe, then the next one is wt (1).iwe
    if (iweEntries.length === 1 && iweEntries[0][0] === 'wt.iwe') return 'wt (1).iwe';

    const inParens: (string | undefined)[] = iweEntries.map(([ name, _ ]) => {
        return /wt( \((?<duplicate>\d+)\))?.iwe/.exec(name)?.groups?.duplicate;
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
    const root: RootNode = outlineView.rootNodes[0].data as RootNode;
    const chaptersContainer: ContainerNode = root.chapters.data as ContainerNode;
    const snipsContainer: ContainerNode = root.snips.data as ContainerNode;

    // Record the chapters and snips containers
    const chaptersRecord: ChaptersRecord = await recordChaptersContainer(chaptersContainer);
    const snipsRecord: SnipsRecord = await recordSnipsContainer(snipsContainer);

    // Get the packageable items to be transported in the workspace
    const packageableItems: { [index: string]: any } = await vscode.commands.executeCommand('wt.getPackageableItems');

    // Create the iwe object
    const iwe: WorkspaceRecord = {
        config: workspace.config,
        chapters: chaptersRecord,
        snips: snipsRecord,
        packageableItems: packageableItems
    };

    // Write the workspace to disk
    const iweJSON = JSON.stringify(iwe, null, 2);
    const iweFilename = await getIweFileName(workspace);
    const iweUri = vscode.Uri.joinPath(workspace.exportFolder, iweFilename);
    await vscode.workspace.fs.writeFile(iweUri, Buff.from(iweJSON, 'utf-8'));
    vscode.window.showInformationMessage(`Successfully created file '${iweFilename}' in '${workspace.exportFolder.fsPath}'`);
}