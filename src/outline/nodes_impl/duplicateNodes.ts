import * as vscode from 'vscode';
import * as vscodeUri from 'vscode-uri';
import { ChapterNode, ContainerNode, FragmentNode, OutlineNode, SnipNode } from "./outlineNode";
import { compareFsPath, ConfigFileInfo, DotConfig, isSubdirectory, writeDotConfig } from '../../miscTools/help';
import { getUsableFileName } from '../impl/createNodes';
import { Extension } from '../../extension';

export async function duplicateChapter (
    chapter: OutlineNode,
    ordering: number,
    destinationContainer: OutlineNode,
    fn: string,
): Promise<OutlineNode> {
    const originalChapterNode = chapter.data as ChapterNode;

    const chapterDestinationPath = vscode.Uri.joinPath(destinationContainer.data.ids.uri, fn);
    await vscode.workspace.fs.createDirectory(chapterDestinationPath);

    let textFragmentContents: OutlineNode[] = [];
    let snipsContainerContent: OutlineNode[] = [];

    let textFragmentContainer: OutlineNode;
    let snipsContainer: OutlineNode;            // Will be a 'container' node if we are pasting as a chapter, and a 'snip' when pasting as a snip

    const textFragmentDotConfig: DotConfig = {};
    const snipsContainerDotConfig: DotConfig = {};

    const textFragmentDotConfigUri: vscode.Uri = vscode.Uri.joinPath(chapterDestinationPath, '.config');
    let snipsContainerDotConfigUri: vscode.Uri;

    // Chapter -> chapter paste
    // The destination container is a chapter group container if the container itself is a container and its parent is also another
    //      container
    if (destinationContainer.data.ids.type === 'container' && destinationContainer.data.ids.parentTypeId === 'container') {

        const snipsContainerUri = vscode.Uri.joinPath(chapterDestinationPath, "snips");
        const snipsContainerNode = new OutlineNode({
            ids: {
                type: 'container',
                display: "Snips",
                fileName: 'snips',
                uri: snipsContainerUri,
                ordering: 1000000,
                parentUri: chapterDestinationPath,
                parentTypeId: 'chapter',
                relativePath: `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}/${fn}`,
            },
            contents: textFragmentContents
        });
        snipsContainerDotConfigUri = vscode.Uri.joinPath(snipsContainerUri, '.config');

        const chapterNode = new OutlineNode({
            ids: {
                fileName: fn,
                parentUri: destinationContainer.data.ids.uri,
                parentTypeId: destinationContainer.data.ids.type,
                uri: chapterDestinationPath,
                relativePath: `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}`,
                ordering: ordering,
                display: `${chapter.data.ids.display} (copy)`,
                description: chapter.data.ids.description ? `${chapter.data.ids.description} (copy)` : undefined,
                type: 'chapter'
            },
            textData: snipsContainerContent,
            snips: snipsContainerNode
        });

        textFragmentContainer = chapterNode;
        snipsContainer = snipsContainerNode;
    }
    // Chapter -> snip paste
    else {

        let maxOrdering = -1;
        originalChapterNode.textData.forEach(text => {
            if (text.data.ids.ordering > maxOrdering) {
                maxOrdering = text.data.ids.ordering;
            }
        });
        

        const snipsContainerFileName = getUsableFileName("snip");
        const snipsContainerUri = vscode.Uri.joinPath(chapterDestinationPath, snipsContainerFileName);
        const snipsContainerNode = new OutlineNode({
            ids: {
                type: 'snip',
                display: "Snips",
                fileName: snipsContainerFileName,
                uri: snipsContainerUri,
                ordering: maxOrdering + 1,
                parentUri: chapterDestinationPath,
                parentTypeId: 'snip',
                relativePath: `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}/${fn}`,
            },
            contents: snipsContainerContent
        });
        snipsContainerDotConfigUri = vscode.Uri.joinPath(snipsContainerUri, '.config');

        const chapterNode = new OutlineNode({
            ids: {
                fileName: fn,
                parentUri: destinationContainer.data.ids.uri,
                parentTypeId: destinationContainer.data.ids.type,
                uri: chapterDestinationPath,
                relativePath: `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}`,
                ordering: ordering,
                display: `${chapter.data.ids.display} (copy)`,
                description: chapter.data.ids.description ? `${chapter.data.ids.description} (copy)` : undefined,
                type: 'snip'
            },
            contents: textFragmentContents
        });

        textFragmentContainer = chapterNode;
        snipsContainer = snipsContainerNode;

        // For chapter -> snip conversions, we also need to add the snips "container" (really just a regular snip)
        //      to the .config
        // Usually for chapters, the snips container is NOT in the .config, but it needs to be when recreated as a snip
        textFragmentDotConfig[snipsContainerFileName] = {
            ordering: maxOrdering + 1,
            title: "Snips",
        };
    }

    const textFragmentContentsPromise: Promise<OutlineNode>[] = [];
    const snipsContainerContentPromise: Promise<OutlineNode>[] = [];

    for (const fragment of originalChapterNode.textData) {

        let copiedFragmentExtension: "md" | "wt";
        const fragExt = vscodeUri.Utils.extname(fragment.data.ids.uri).toLocaleLowerCase();
        if (fragExt.endsWith('md')) {
            copiedFragmentExtension = 'md';
        }
        else {
            copiedFragmentExtension = 'wt';
        }

        const destinationFileName = getUsableFileName(fragment.data.ids.type, copiedFragmentExtension);
        textFragmentDotConfig[destinationFileName] = {
            ordering: fragment.data.ids.ordering,
            title: `${fragment.data.ids.display} (copy)`,
            description: fragment.data.ids.description ? `${fragment.data.ids.description} (copy)` : undefined
        };
        textFragmentContentsPromise.push(duplicateFragment(fragment, fragment.data.ids.ordering, textFragmentContainer, destinationFileName));
    }

    for (const snip of (originalChapterNode.snips.data as ContainerNode).contents) {
        const destinationFileName = getUsableFileName("snip");
        snipsContainerDotConfig[destinationFileName] = {
            ordering: snip.data.ids.ordering,
            title: `${snip.data.ids.display} (copy)`,
        };
        snipsContainerContentPromise.push(duplicateSnip(snip, snip.data.ids.ordering, snipsContainer, destinationFileName));
    }

    await Promise.all([
        writeDotConfig(textFragmentDotConfigUri, textFragmentDotConfig),
        writeDotConfig(snipsContainerDotConfigUri, snipsContainerDotConfig),
    ]);

    textFragmentContents.push(...(await Promise.all(textFragmentContentsPromise)));
    snipsContainerContent.push(...(await Promise.all(snipsContainerContentPromise)));

    return textFragmentContainer;
}

// Should be called under the assumption that the snip has been added to .config of destination already
export async function duplicateSnip (
    snip: OutlineNode, 
    ordering: number,
    destinationContainer: OutlineNode, 
    fn: string
): Promise<OutlineNode> {
    const snipDestinationPath = vscode.Uri.joinPath(destinationContainer.data.ids.uri, fn);
    await vscode.workspace.fs.createDirectory(snipDestinationPath);

    const snipContent: OutlineNode[] = [];
    const copiedSnip = new OutlineNode({
        contents: snipContent,
        ids: {
            fileName: fn,
            parentUri: destinationContainer.data.ids.uri,
            parentTypeId: destinationContainer.data.ids.type,
            uri: snipDestinationPath,
            relativePath: `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}`,
            ordering: ordering,
            display: `${snip.data.ids.display} (copy)`,
            description: snip.data.ids.description ? `${snip.data.ids.description} (copy)` : undefined,
            type: 'snip'
        }
    });

    const newConfig: Record<string, ConfigFileInfo> = {};
    for (const content of (snip.data as SnipNode).contents) {
        const contentType = content.data.ids.type;

        let copiedFragmentExtension: "md" | "wt" | undefined = undefined;
        if (contentType === 'fragment') {
            const fragExt = vscodeUri.Utils.extname(content.data.ids.uri).toLocaleLowerCase();
            if (fragExt.endsWith('md')) {
                copiedFragmentExtension = 'md';
            }
            else if (fragExt.endsWith('wt')) {
                copiedFragmentExtension = 'wt';
            }
        }

        const destinationFileName = getUsableFileName(contentType, copiedFragmentExtension);
        const contentOrdering = content.data.ids.ordering;
        newConfig[destinationFileName] = {
            ordering: contentOrdering,
            title: `${content.data.ids.display} (copy)`,
        };

        if (contentType === 'fragment') {
            const copied = await duplicateFragment(content, contentOrdering, copiedSnip, destinationFileName);
            snipContent.push(copied);
        }
        else if (contentType === 'snip') {
            const copied = await duplicateSnip(content, contentOrdering, copiedSnip, destinationFileName);
            snipContent.push(copied);
        }
        else throw `Unexpected inner-snip content type: ${contentType}`;
    }

    const newConfigLocation = vscode.Uri.joinPath(snipDestinationPath, '.config');
    await writeDotConfig(newConfigLocation, newConfig);
    return copiedSnip;
};

// Should be called under the assumption that the fragment has been added to .config of destination already
export async function duplicateFragment (
    fragment: OutlineNode, 
    ordering: number,
    destinationContainer: OutlineNode,
    fn: string
): Promise<OutlineNode> {
    const destinationPath = vscode.Uri.joinPath(destinationContainer.data.ids.uri, fn);
    await vscode.workspace.fs.copy(fragment.data.ids.uri, destinationPath);
    return new OutlineNode({
        md: (fragment.data as FragmentNode).md,
        ids: {
            fileName: fn,
            parentUri: destinationContainer.data.ids.uri,
            parentTypeId: destinationContainer.data.ids.type,
            uri: destinationPath,
            relativePath: `${destinationContainer.data.ids.relativePath}/${destinationContainer.data.ids.fileName}`,
            ordering: ordering,
            display: `${fragment.data.ids.display} (copy)`,
            description: fragment.data.ids.description ? `${fragment.data.ids.description} (copy)` : undefined,
            type: 'fragment'
        }
    })
};
