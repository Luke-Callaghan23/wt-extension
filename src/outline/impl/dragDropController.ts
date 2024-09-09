import * as vscode from 'vscode';
import { OutlineNode } from "../nodes_impl/outlineNode";
import { OutlineView } from "../outlineView";
import { RecyclingBinView } from '../../recyclingBin/recyclingBinView';
import { UriBasedView } from '../../outlineProvider/UriBasedView';
import { MoveNodeResult } from '../nodes_impl/handleMovement/common';
import { ScratchPadView } from '../../scratchPad/scratchPadView';
import { ExtensionGlobals } from '../../extension';
import { setFsPathKey } from '../../miscTools/help';

export async function handleDropController (this: OutlineView, target: OutlineNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const targ = target || this.rootNodes[0];
    if (!targ) throw 'unreachable';

    let overrideDestination: OutlineNode | null = null;

    const effectedContainersUriMap: {
        [index: string]: OutlineNode,
    } = {};

    const recyclingView: RecyclingBinView = ExtensionGlobals.recyclingBinView;
    const scratchPadView: ScratchPadView = ExtensionGlobals.scratchPadView;

    const moveOperations: { 
        dataTransferType: string, 
        operation: 'move' | 'recover' | 'scratch' | 'paste',
        sourceProvider: UriBasedView<OutlineNode>
    }[] = [{
        dataTransferType: 'application/vnd.code.tree.outline',
        operation: 'move',
        sourceProvider: this,
    }, {
        dataTransferType: 'application/vnd.code.tree.recycling',
        operation: 'recover',
        sourceProvider: recyclingView
    }, {
        dataTransferType: 'application/vnd.code.tree.scratch',
        operation: 'scratch',
        sourceProvider: scratchPadView
    }, {
        dataTransferType: 'application/vnd.code.copied',
        operation: 'paste',
        sourceProvider: this,
    }];

    for (const{ dataTransferType, operation, sourceProvider } of moveOperations) {
        const transferItems = dataTransfer.get(dataTransferType);
        if (!transferItems) continue;

        let movedOutlineItems: OutlineNode[];


        // When the transfer item comes from another view, it seems that the tranfer item is stringified before landing here
        //		so when the recycling bin tranfers nodes to recover, they will come as JSON strings
        // To recover from this, JSON parse the transfered nodes, then search the recycling bin view for those items by their 
        //		uris
        if (typeof transferItems.value === 'string') {
            const movedItemsJSON: OutlineNode[] = JSON.parse(transferItems.value as string);
            const movedRecyclingItemsRaw: (OutlineNode | null)[] = await Promise.all(
                movedItemsJSON.map(mij => {
                    // Convert to a string then back to the Uri because I'm not sure if the parsed JSON will be correctly viewed
                    //		as an instanceof vscode.Uri on all platforms
                    const uri = vscode.Uri.file(mij.data.ids.uri.fsPath);
                    if (operation === 'recover') {
                        return recyclingView.getTreeElementByUri(uri) as Promise<OutlineNode | null>;
                    }
                    else if (operation === 'scratch') {
                        return scratchPadView.getTreeElementByUri(uri) as Promise<OutlineNode | null>;
                    }
                    else return null;
                })
            );

            // The 'Dummy' node that tells users to drag and drop onto it to delete is the only possible
            //		node with a fragment type and a root parent type
            // Obviously, we do not want to recover this node, so ignore it
            movedOutlineItems = movedRecyclingItemsRaw.filter(ri => {
                return ri && !(ri.data.ids.type === 'fragment' && ri.data.ids.parentTypeId === 'root');
            }) as OutlineNode[];
        }
        else {
            movedOutlineItems = transferItems.value;
        }

        // Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
        const uniqueRoots = await this.getLocalRoots(movedOutlineItems);
        const filteredOutlineParents = operation !== 'paste'
            ? uniqueRoots.filter(root => root.getParentUri().toString() !== targ.getUri().toString())
            : uniqueRoots;

        // Move all the valid nodes into the target
        if (filteredOutlineParents.length <= 0) continue;

        let rememberedMoveDecision: 'Reorder' | 'Insert' | null = null;

        // Offset tells how many nodes have moved downwards in the same container so far
        // In the case where multiple nodes are moving downwards at once, it lets
        //		.moveNode know how many nodes have already moved down, and 
        //		lets it adapt to those changes
        let offset = 0;
        for (const mover of filteredOutlineParents) {

            let actualOperation: 'recover' | 'move' | 'scratch' | 'paste';
            let sourceView: OutlineView | ScratchPadView | RecyclingBinView;
            switch (operation) {
                case 'scratch': {
                    actualOperation = 'scratch';
                    sourceView = scratchPadView;
                } break;
                case 'recover': {
                    actualOperation = 'recover';
                    sourceView = recyclingView;
                } break;
                case 'paste': {
                    actualOperation = 'paste';
                    sourceView = this;
                } break;
                case 'move': 
                default: {
                    actualOperation = 'move';
                    sourceView = this;
                }
            }

            if (actualOperation === 'paste') rememberedMoveDecision = 'Insert';

            // Do the move on the target destination with the selected operation
            const res: MoveNodeResult = await mover.generalMoveNode(
                actualOperation, targ, sourceProvider,				// the source is either the outline tree for 'move's or the recycling bin for 'recovers'
                this, offset, overrideDestination,
                rememberedMoveDecision,
            );
            const { moveOffset, createdDestination, effectedContainers, rememberedMoveDecision: moveDecision } = res;
            if (moveOffset === -1) break;
            offset += moveOffset;

            rememberedMoveDecision = moveDecision || rememberedMoveDecision;

            // If there was a destination created by the latest move, then use that destination as the override destination for 
            //		all future moves in this function call
            // New destinations are created when dragging a fragment into a snip container (a new snip is created inside of the
            //		snip container and all future fragments will also be tranferred into that container)
            if (createdDestination) {
                overrideDestination = createdDestination;
            }

            for (const container of effectedContainers) {
                setFsPathKey<OutlineNode>(container.getUri(), container, effectedContainersUriMap);
            }

            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Refresh the entire recycling/scratch view every time we recover, because the recycling/scratch should be rather 
        //		small most of the time
        if (operation === 'recover') {
            await recyclingView.refresh(false, []);
        }
        if (operation === 'scratch') {
            await scratchPadView.refresh(false, []);
        }
    }

    const allEffectedContainers = Object.entries(effectedContainersUriMap)
        .map(([ _, container ]) => container);

    const anyRoot = !!allEffectedContainers.find(effected => effected.data.ids.type === 'root');
    if (anyRoot) {
        this.refresh(true, []);
    }
    else {
        // If any of the effected containers is the root container, then the move node function is telling us to refresh the entire tree
        this.refresh(false, allEffectedContainers);
    }
}

export async function handleDragController (this: OutlineView, source: OutlineNode[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    treeDataTransfer.set('application/vnd.code.tree.outline', new vscode.DataTransferItem(source));

    const uris: vscode.Uri[] = source.map(src => src.getDroppableUris()).flat();
    const uriStrings = uris.map(uri => uri.toString());
    
    // Combine all collected uris into a single string
    const sourceUriList = uriStrings.join('\r\n');
    treeDataTransfer.set('text/uri-list', new vscode.DataTransferItem(sourceUriList));
}