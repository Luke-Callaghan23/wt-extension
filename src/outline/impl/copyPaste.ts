import * as vscode from 'vscode';
import { ChapterNode, ContainerNode, FragmentNode, OutlineNode, RootNode, SnipNode } from '../nodes_impl/outlineNode';
import { OutlineView } from '../outlineView';
import { FileAccessManager } from '../../miscTools/fileAccesses';
import { getUsableFileName } from './createNodes';
import { ConfigFileInfo, getFsPathKey, getLatestOrdering, readDotConfig, setFsPathKey, writeDotConfig } from '../../miscTools/help';
import * as extension from './../../extension';

export type CopiedSelection = {
    count: number;
    nodes: OutlineNode[],
    type: 'fragment' | 'snip' | 'chapter' | 'chapterSnipsContainer' | 'workSnipsContainer' | 'chaptersContainer'
};

export async function copy (
    this: OutlineView,
    selected: readonly OutlineNode[]
): Promise<void> {

    const allSelections: OutlineNode[] = [];
    selected.forEach(node => {
        switch (node.data.ids.type) {
            case 'chapter':
                allSelections.push(node);
                break;
            case 'snip':
                allSelections.push(node);
                break;
            case 'fragment':
                allSelections.push(node);
                break;
            case 'container': 
                // Need to check what kind of content this container holds before pushing the node
                //      into one of the above buckets

                // The chapters container and work snips container are the only nodes
                //      in the outline tree whose parent types are `'root'`
                if (node.data.ids.parentTypeId === 'root') {
                    // Work snips and chapters containers can be differentiated by the type id
                    //      of their first child
                    const children = (node.data as ContainerNode).contents;

                    // If the container does not have any children, then there's nothing to copy anyways,
                    //      so just skip
                    if (children.length === 0) return;

                    // If the first child of the container is a chapter, then this container is the chapters
                    //      container, and it is the work snips container otherwise
                    const firstChild = children[0];
                    if (firstChild.data.ids.type === 'snip') {
                        allSelections.push(node);
                    }
                    else if (firstChild.data.ids.type === 'chapter') {
                        allSelections.push(node);
                    }
                    else throw 'Not reachable';
                }
                // The only other kind of container that exists are chapter snips containers
                //      these have parent type ids of `'chapter'`
                else if (node.data.ids.parentTypeId === 'chapter') {
                    allSelections.push(node);
                }
                else throw 'Not reachable';
                break;
            // Never copy the root element
            case 'root': break;
        }
    });

    const copiedSelection: CopiedSelection = {
        count: allSelections.length,
        nodes: allSelections,
        type: 'snip',
    };

    // Send message with names of copied resources to user
    const copiedNames = copiedSelection.nodes.map(node => node.data.ids.display);
    const copiedNamesStr = copiedNames.join("', '");
    const copiedCount = copiedNames.length;
    const message = `Successfully copied (${copiedCount}) resources: '${copiedNamesStr}'`;
    vscode.window.showInformationMessage(message);

    // Emit a warning if there was any amount of ignored content
    if (selected.length !== copiedSelection.count) {
        const ignoredCount = selected.length - copiedSelection.count;
        vscode.window.showWarningMessage(`Ignored (${ignoredCount}) items in copy`);
    }

    // Store references to the copied contents in workspace state
    return this.context.workspaceState.update('copied', copiedSelection);
}

export async function pasteNew (
    this: OutlineView,
    destination: OutlineNode,
    copied: CopiedSelection,
) {
    for (const copiedNode of copied.nodes) {
        const moveResult = await copiedNode.generalMoveNode(
            'paste', 
            destination,
            extension.ExtensionGlobals.recyclingBinView,
            extension.ExtensionGlobals.outlineView,
            0, null, 'Insert'
        );
        if (moveResult.moveOffset === -1) return;
    }
}

export async function genericPaste (destinations: OutlineNode[]) {
    
    const context = extension.ExtensionGlobals.context;
    const outlineView = extension.ExtensionGlobals.outlineView;

    // Ensure that there are items to paste currently stored in workspace state
    const copied: CopiedSelection | undefined = context.workspaceState.get<CopiedSelection>('copied');
    if (!copied) return;

    // Find all copied items that still exist in the tree in the same location
    const copies: (OutlineNode | undefined | null)[] = await Promise.all(copied.nodes.map(copy => {
        return outlineView.getTreeElementByUri(copy.data.ids.uri) as Promise<OutlineNode | null | undefined>;
    }));
    const validCopiedNodes = copies.filter(copy => copy) as OutlineNode[];

    // Ensure that there still exists some valid nodes to paste
    if (validCopiedNodes.length === 0) return;

    const dataTransfer: vscode.DataTransfer = {
        get(mimeType) {
            if (mimeType !== 'application/vnd.code.copied') return undefined;
            return new vscode.DataTransferItem(copied.nodes);
        },
        forEach(callbackfn, thisArg) {
            callbackfn(new vscode.DataTransferItem(copied.nodes), 'application/vnd.code.copied', dataTransfer);
        },
        [Symbol.iterator]: function (): IterableIterator<[mimeType: string, item: vscode.DataTransferItem]> {
            throw new Error("I'll be honest I have not clue how to return one of these correctly.  Should never be called in the code, so I don't care either.");
        },
        set(mimeType, value) {
            throw new Error("Yeah this should never be called either.")
        },
    }
    for (const dest of destinations) {
        await outlineView.handleDrop(dest, dataTransfer, {
            isCancellationRequested: false,
            onCancellationRequested: ()=>{
                return new vscode.Disposable(()=>{})
            }
        });
    }
}