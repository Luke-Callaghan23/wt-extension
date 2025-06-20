import * as vscode from 'vscode';
import { OutlineNode } from "../nodes_impl/outlineNode";
import { OutlineView } from "../outlineView";
import { RecyclingBinView } from '../../recyclingBin/recyclingBinView';
import { UriBasedView } from '../../outlineProvider/UriBasedView';
import { MoveNodeResult } from '../nodes_impl/handleMovement/common';
import { ScratchPadView } from '../../scratchPad/scratchPadView';
import { ExtensionGlobals } from '../../extension';
import { defaultProgress, getNodeNamePath, getSectionedProgressReporter, isSubdirectory, progressOnViews, setFsPathKey } from '../../miscTools/help';
import { capitalize } from '../../miscTools/help';
import * as vscodeUri from 'vscode-uri';

export type DataTransferType = 
    'application/vnd.code.tree.outline'
    | 'application/vnd.code.tree.recycling'
    | 'application/vnd.code.tree.scratch'
    | 'application/vnd.code.copied'
    | 'application/vnd.code.tree.import.fileexplorer'
    | 'text/uri-list'
    ;

export async function handleDropController (this: OutlineView, target: OutlineNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const targ = target || this.rootNodes[0];
    if (!targ) throw 'unreachable';

    // Handle drops from the import file system view
    // These are handled specially because they do not involve messing with outline trees or internal nodes
    //      it just opens the import form and goes through the normal importing process
    // INFO: this entire block isn't using Entry or DroppedSourceInfo types from import views because if I imported them
    //      in the main extension I'd have to do a lot of annoying stuff to avoid importing them in the
    //      web extension
    const importTreeData = dataTransfer.get('application/vnd.code.tree.import.fileexplorer');
    if (importTreeData) {

        // Parse the entries from the data transfer item
        let entries: { uri: vscode.Uri }[];
        if (typeof importTreeData.value === 'string') {
            entries = JSON.parse(importTreeData.value);
        }
        else {
            entries = importTreeData.value as { uri: vscode.Uri } [];
        }

        // Open the import form with all the dropped entry uris
        const uris = entries.map(({ uri }) => uri);
        vscode.commands.executeCommand('wt.import.fileExplorer.importFolder', uris, {
            node: targ,
            namePath: await getNodeNamePath(targ),
            destination: targ.data.ids.type === 'chapter'
                ? 'chapter'
                : 'snip'
        });
    }

    // Handle drops from outside file system into Outline Tree
    // See above comments
    const importUriData = dataTransfer.get('text/uri-list');
    if (importUriData) {
        const uris: vscode.Uri[] = importUriData.value.split('\n')
            .map((uriString: string) => vscode.Uri.parse(uriString.trim()))
            .filter((uri: vscode.Uri) => {
                const ext = vscodeUri.Utils.extname(uri).replace(".", "");

                // Only try to import valid file types that come from outside WTANIWE
                return !(isSubdirectory(this.workspace.chaptersFolder, uri) || isSubdirectory(this.workspace.workSnipsFolder, uri) || isSubdirectory(this.workspace.scratchPadFolder, uri) || isSubdirectory(this.workspace.recyclingBin, uri))
                    && this.workspace.importFileTypes.includes(ext)
            });

        if (uris.length > 0) {
            await vscode.commands.executeCommand('wt.import.fileExplorer.importDroppedDocuments', uris, target);
        }
    }


    let overrideDestination: OutlineNode | null = null;

    const effectedContainersUriMap: {
        [index: string]: OutlineNode,
    } = {};

    const recyclingView: RecyclingBinView = ExtensionGlobals.recyclingBinView;
    const scratchPadView: ScratchPadView = ExtensionGlobals.scratchPadView;

    const moveOperations: { 
        dataTransferType: DataTransferType, 
        operation: 'move' | 'recover' | 'scratch' | 'paste' | 'import',
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
        
        let rememberedMoveDecision: 'Reorder' | 'Insert' | null = null;

        let actualOperation: 'recover' | 'move' | 'scratch' | 'paste';
        let additionalViewToUpdate: undefined | string;
        let sourceView: OutlineView | ScratchPadView | RecyclingBinView;
        switch (operation) {
            case 'scratch': {
                actualOperation = 'scratch';
                additionalViewToUpdate = ScratchPadView.viewId;
                sourceView = scratchPadView;
            } break;
            case 'recover': {
                actualOperation = 'recover';
                additionalViewToUpdate = RecyclingBinView.viewId;
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

        const actualOperationGerund = capitalize (
            actualOperation[actualOperation.length - 1] === 'e'
                ? actualOperation.substring(0, actualOperation.length - 1) + 'ing'
                : actualOperation + 'ing'
        );


        const views = [ OutlineView.viewId ];
        if (additionalViewToUpdate) {
            views.push(additionalViewToUpdate);
        }
        await progressOnViews(views, `${actualOperationGerund} Files`, async (progress) => {
            let movedOutlineItems: OutlineNode[];
            
            progress.report({ message: "Parsing input" });
    
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

            progress.report({ message: "Finding unique roots" })
    
            // Filter out any transferer whose parent is the same as the target, or whose parent is the same as the target's parent
            const uniqueRoots = await this.getLocalRoots(movedOutlineItems);
            const filteredOutlineParents = operation !== 'paste'
                ? uniqueRoots.filter(root => root.getParentUri().toString() !== targ.getUri().toString())
                : uniqueRoots;
    
            // Move all the valid nodes into the target
            if (filteredOutlineParents.length <= 0) return;
            
            const reporter = getSectionedProgressReporter (
                filteredOutlineParents.map((_, index) => index.toString()), 
                progress
            );
            
            // Offset tells how many nodes have moved downwards in the same container so far
            // In the case where multiple nodes are moving downwards at once, it lets
            //		.moveNode know how many nodes have already moved down, and 
            //		lets it adapt to those changes
            let offset = 0;
            for (const mover of filteredOutlineParents) {
                reporter(`${actualOperationGerund} '${mover.data.ids.display}'`);
    
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
        });
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

export async function handleDragController (this: UriBasedView<OutlineNode>, dataTransferType: DataTransferType, source: OutlineNode[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    treeDataTransfer.set(dataTransferType, new vscode.DataTransferItem(source));

    const uris: vscode.Uri[] = source.map(src => src.getDroppableUris()).flat();
    const uriStrings = uris.map(uri => uri.toString());
    
    // Combine all collected uris into a single string
    const sourceUriList = uriStrings.join('\r\n');
    treeDataTransfer.set('text/uri-list', new vscode.DataTransferItem(sourceUriList));
}