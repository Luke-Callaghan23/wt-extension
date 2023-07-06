/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../vsconsole';
import { OutlineTreeProvider, TreeNode } from '../outlineProvider/outlineTreeProvider';
import { ConfigFileInfo, getLatestOrdering, readDotConfig, writeDotConfig } from '../help';
import { OutlineView } from './outlineView';
import * as fsNodes from '../outlineProvider/fsNodes';
import * as extension from '../extension';

export const usedIds: { [index: string]: boolean } = {};

// Map of a resource type to all resource types that the key can be moved into
const allowedMoves: { [index: string]: ResourceType[] } = {
    'snip': [
        'chapter',
        'fragment',
        'root',
        'container',
        'snip'
    ],
    'chapter': [
        'chapter'
    ],
    'root': [],
    'container': [
        'chapter',
        'root',
        'snip',
        'container',
        'fragment'
    ],
    'fragment': [
        'chapter',
        'snip',
        'fragment'
    ],
};

export type ChapterNode = fsNodes.ChapterNode<OutlineNode>;
export type ContainerNode = fsNodes.ContainerNode<OutlineNode>;
export type SnipNode = fsNodes.SnipNode<OutlineNode>;
export type RootNode = fsNodes.RootNode<OutlineNode>;
export type FragmentData = fsNodes.FragmentData;
export type ResourceType = fsNodes.ResourceType;
export type NodeTypes = RootNode | SnipNode | ChapterNode | FragmentData | ContainerNode;

export class OutlineNode extends TreeNode {

    // Assumes this is a 'snip' or a 'fragment'
    // Traverses up the parent tree until a 'chapter' or 'root' element is found
	async getContainerParent (provider: OutlineTreeProvider<TreeNode>, secondary: string = 'root'): Promise<OutlineNode> {
		// Traverse upwards until we find a 'chapter' or 'root' node
        // Both of these node types have a snips container within them that we can then use to store the new node
        let foundParent: OutlineNode;
        let parentUri = this.data.ids.parentUri;
        while (true) {
            foundParent = await provider._getTreeElementByUri(parentUri);
            if (foundParent.data.ids.type === secondary || foundParent.data.ids.type === 'chapter') {
                break;
            }
            parentUri = foundParent.data.ids.parentUri;
        }

        // Convert the root or chapter parent to a more declarative type, and return the snips container
        return foundParent;
	}

    // Shifts all the nodes that 
    async shiftTrailingNodesDown (view: OutlineTreeProvider<OutlineNode>): Promise<string> {
        // Edit the old .config to remove the moved record
        const oldDotConfigUri = await this.getDotConfigPath();
        if (!oldDotConfigUri) {
            vscode.window.showErrorMessage(`Error: could not find .config file at expected path '${oldDotConfigUri}'.  Please do not mess with the file system of a IWE environment!`);
            throw new Error('Unable to retrieve .config path');
        }

        // Readh the .config
        const oldDotConfig = await readDotConfig(oldDotConfigUri);
        if (!oldDotConfig) {
            vscode.window.showErrorMessage(`Error: could not read .config file at path '${oldDotConfigUri}'.  Please do not mess with the file system of a IWE environment!`);
            throw new Error('Unable to retrieve .config data');
        }
        
        // Shift all the fragment records that come after this downwards
        const thisConfig = oldDotConfig[this.data.ids.fileName];
        Object.getOwnPropertyNames(oldDotConfig).forEach(fileName => {
            const record = oldDotConfig[fileName];
            if (record.ordering > thisConfig.ordering) {
                record.ordering -= 1;
            }
        });

        // Copy the name of the moved record, and delete the old record
        const movedTitle = oldDotConfig[this.data.ids.fileName].title;
        delete oldDotConfig[this.data.ids.fileName];
        
        // Rewrite the .config file to the disk
        await writeDotConfig(oldDotConfigUri, oldDotConfig);
        return movedTitle;
    }

    async moveNode (
        newParent: TreeNode, 
        provider: OutlineTreeProvider<TreeNode>,
        moveOffset: number = 0
    ): Promise<number> {
        const newParentNode = newParent as OutlineNode;
        const newParentType = newParentNode.data.ids.type;
        const newParentUri = newParentNode.data.ids.uri;
        
        const moverType = this.data.ids.type;
        const moverParentUri = this.data.ids.parentUri;
        
        const thisAllowedMoves = allowedMoves[moverType];
        if (!thisAllowedMoves.find(allowed => allowed === newParentType)) {
            return -1;
        }

        if (moverType === 'container') {
            // If the moving item is a container, it must be a snip container
            // Check to make sure that the type of the first child of the container is a snip
            const moverNode = this.data as ContainerNode;
            const moverContent: OutlineNode[] = moverNode.contents;
            if (moverContent.length === 0 || moverContent[0].data.ids.type === 'chapter') {
                throw new Error('Not possible');
            }
            
            // Find the target where the snip should move into
            let containerTarget: TreeNode;
            containerTarget = newParent;

            // Move each snip in the mover's content into the target container found above by recusing into this function again
            return (await Promise.all(
                moverContent.map(
                    snip => snip.moveNode(containerTarget, provider)
                )
            )).reduce((acc, n) => {
                if (acc === -1 || n == -1) {
                    return -1;
                }
                return acc + n;
            }, 0);
        }

        // If the mover is not a container, then we're only moving a single item:

        let destinationContainer: OutlineNode;
        if (moverType === 'snip') {
            // Use the root's .snips container
            if (newParentType === 'root') {
                const root: RootNode = (provider.tree as OutlineNode).data as RootNode;
                destinationContainer = (root.snips as OutlineNode);
            }
            // Use the chapter's .snips container
            else if (newParentType === 'chapter') {
                const chapterNode: ChapterNode = (await provider._getTreeElementByUri(newParentUri)).data;
                destinationContainer = chapterNode.snips;
            }
            // Traverse upwards until we find the nearest 'root' or 'chapter' node that we can move the snip into
            else if (newParentType === 'snip' || newParentType === 'container' || newParentType === 'fragment') {
                const parentContainerNode = (await newParentNode.getContainerParent(provider)).data as ChapterNode | RootNode;
                destinationContainer = parentContainerNode.snips;
            }
            else {
                throw new Error('Not possible');
            }
        }
        else if (moverType === 'fragment') {
            if (newParentType === 'chapter' || newParentType === 'snip') {
                destinationContainer = (await provider._getTreeElementByUri(newParentUri));
            }
            else if (newParentType === 'fragment') {
                destinationContainer = (await newParentNode.getContainerParent(provider, 'snip'));
            }
            else {
                throw new Error('Not possible.');
            }
        }  
        else if (moverType === 'chapter') {
            destinationContainer = ((provider.tree as OutlineNode).data as RootNode).chapters;
        }
        else {
            return -1;
        }

        // If the container of the destination is the same as the container of the mover
        // Then we're not actually moving the node anywhere, we are just changing the internal ordering
        if (destinationContainer.getUri().toString() === moverParentUri.toString()) {
            
            // Get the .config for the container -- this contains the ordering values for both the mover
            //      and the destination item
            // (Destination item is just the item that the mover was dropped onto -- not actually destination,
            //      as there is no moving actually occurring)
            const containerDotConfigUri = await destinationContainer.getDotConfigPath();
            if (!containerDotConfigUri) return -1;

            const containerConfig = await readDotConfig(containerDotConfigUri);
            if (!containerConfig) return -1;

            type FileInfo = {
                filename: string,
                config: ConfigFileInfo
            };

            // Buckets for items pre-reorder
            // Container for items that come between the mover and the detination
            const between: FileInfo[] = [];         

            // Minimum and maximum are just aliases for the mover and the destination where "min" is the 
            //      items that has a lower ordering and "max" is the item that has higher ordering
            const moverOrdering = containerConfig[this.data.ids.fileName].ordering;
            const destOrdering = containerConfig[newParentNode.data.ids.fileName].ordering;
            const [ min, max ] = moverOrdering < destOrdering
                ? [ moverOrdering, destOrdering ]
                : [ destOrdering, moverOrdering ];

            let minEntry: FileInfo | null = null;
            let maxEntry: FileInfo | null = null;

            // Place all items in the .config into their respective buckets
            Object.entries(containerConfig).forEach(([ filename, info ]) => {
                if (info.ordering === min) minEntry = { filename, config: info };                   // ordering is min -> min
                if (info.ordering === max + moveOffset) maxEntry = { filename, config: info };      // ordering is max -> max
                else if (info.ordering > min && info.ordering < max + moveOffset) {
                    between.push({ filename, config: info });
                }
            });
            if (!minEntry || !maxEntry) {
                throw new Error ('Not possible');
            }

            let off = 0;
            if (moverOrdering < destOrdering) {
                // If the mover comes before the destination, then move it after
                const mover = minEntry as FileInfo;
                const dest = maxEntry as FileInfo;

                // All items in between get shifted down
                between.forEach(({ filename }) => {
                    containerConfig[filename].ordering -= 1;
                });

                // Destination gets shifted down
                const oldDestOrdering = containerConfig[dest.filename].ordering;
                containerConfig[dest.filename].ordering = oldDestOrdering - 1;

                // Mover gets old destination's ordering
                containerConfig[mover.filename].ordering = oldDestOrdering;

                // Tell the caller that a node has moved downwards
                // So that if there are multiple nodes moving downwards in the same container,
                //      the next time moveNode is called we know
                off = 1;
            }
            else {
                // If the mover comes after the destination, then move it before
                const mover = maxEntry as FileInfo;
                const dest = minEntry as FileInfo;

                // All items in between get shifted up
                between.forEach(({ filename }) => {
                    containerConfig[filename].ordering += 1;
                });

                // Destination gets shifted up
                const oldDestOrdering = containerConfig[dest.filename].ordering;
                containerConfig[dest.filename].ordering = oldDestOrdering + 1;

                // Mover gets old destination's ordering
                containerConfig[mover.filename].ordering = oldDestOrdering;
            }

            // Write the edited config back to the disk
            await writeDotConfig(containerDotConfigUri, containerConfig);

            // Find the unordered list from the parent node based on the mover type
            let unordered: OutlineNode[];
            if (moverType === 'chapter') {
                unordered = (destinationContainer.data as ContainerNode).contents;
            }
            else if (moverType === 'fragment') {
                unordered = (destinationContainer.data as SnipNode | ChapterNode).textData;
            }
            else if (moverType === 'snip') {
                unordered = (destinationContainer.data as ContainerNode).contents;
            }

            // Now order the contents of the actual objects for refreshing the view
            const reordered: OutlineNode[] = Array(Object.keys(containerConfig).length);
            Object.entries(containerConfig).forEach(([ fileName, config ]) => {
                // Find the node itself in the unordered list
                const moving = unordered.find(un => un.data.ids.fileName === fileName);
                if (!moving) return;
                reordered[config.ordering] = moving;
            });

            // Do the inverse of the above
            if (moverType === 'chapter') {
                (destinationContainer.data as ContainerNode).contents = reordered;
            }
            else if (moverType === 'fragment') {
                (destinationContainer.data as SnipNode | ChapterNode).textData = reordered;
            }
            else if (moverType === 'snip') {
                (destinationContainer.data as ContainerNode).contents = reordered;
            }

            return off;
        }
        
        // Path for the old config file and old file
        const moverUri = this.getUri();

        // Path for the new fragment, and its new .config file
        const destinationFolderUri = destinationContainer.getUri();
        const destinationDotConfigUri = await destinationContainer.getDotConfigPath();
        if (!destinationDotConfigUri) return  -1;

        const destinationUri = vscode.Uri.joinPath(destinationFolderUri, this.data.ids.fileName);

        try {

            // Edit the new .config to add the moved record
            const destinationDotConfig = await readDotConfig(destinationDotConfigUri);
            if (!destinationDotConfig) return 0;

            // Find the record in the new .config file with the highest ordering
            const latestFragmentNumber = getLatestOrdering(destinationDotConfig);
            const movedFragmentNumber = latestFragmentNumber + 1;

            const movedRecordTitle = await this.shiftTrailingNodesDown(provider as OutlineTreeProvider<OutlineNode>);
            if (movedRecordTitle === '') {
                return 0;
            }

            // Add the record for the moved fragment to the new .config file and write to disk
            destinationDotConfig[this.data.ids.fileName] = {
                title: movedRecordTitle,
                ordering: movedFragmentNumber
            };
            await writeDotConfig(destinationDotConfigUri, destinationDotConfig);

            // Finally move data with the move function specified above
            await vscode.workspace.fs.rename(moverUri, destinationUri);

            // Once the moves have occurred on disk, then move the nodes in the actual objects
            if (moverType === 'snip') {

                // Add this node to the contents of the destination container
                ((destinationContainer.data as ChapterNode | RootNode).snips.data as ContainerNode).contents.push(this);

                // Remove this node from the contents of its old parent
                // Get the old parent
                const oldParentUri = this.data.ids.parentUri;
                const oldParentNode = ((await provider._getTreeElementByUri(oldParentUri)) as OutlineNode).data as ChapterNode | RootNode;
                const oldParentContents = (oldParentNode.snips.data as ContainerNode).contents;

                // Get the index of the mover in the parent's contents
                const moverUri = this.getUri().toString();
                const oldParentIndex = oldParentContents.findIndex(node => node.getUri().toString() === moverUri);
                if (oldParentIndex === -1) return -1;

                // Remove this from parent
                oldParentContents.splice(oldParentIndex, 1);
            }
            else if (moverType === 'fragment') {
                // Push this fragment into the new parent
                (destinationContainer.data as ChapterNode | SnipNode).textData.push(this);

                const oldParentUri = this.data.ids.parentUri;
                const oldParentNode = (await provider._getTreeElementByUri(oldParentUri) as OutlineNode).data as ChapterNode | SnipNode;
                const oldParentContents = oldParentNode.textData;

                // Get the index of the mover in the parent's contents
                const moverUri = this.getUri().toString();
                const oldParentIndex = oldParentContents.findIndex(node => node.getUri().toString() === moverUri);
                if (oldParentIndex === -1) return -1;

                // Remove this from parent
                oldParentContents.splice(oldParentIndex, 1);
            }

            return 0;
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error: unable to move fragment file: ${e}`);
            return 0;
        }
    }

    getParentUri(): vscode.Uri {
        return this.data.ids.parentUri;
    }
    getTooltip (): string | vscode.MarkdownString {
        return `${this.data.ids.type} | actual name: ${this.getUri()}`;
    }
    
    hasChildren (): boolean {
        return this.data.ids.type !== 'fragment';
    }

    getUri(): vscode.Uri {
        return this.data.ids.uri;
    }
    getDisplayString (): string {
        return this.data.ids.display;
    }

    async getChildren (): Promise<OutlineNode[]> {
        const data = this.data;
        if (data.ids.type === 'chapter') {
            // Collect all text fragments of the chapter node as well as all snips
            const chapter = data as ChapterNode;

            // Collect and order all the fragment data
            const fragments = chapter.textData.map(td => td as unknown as OutlineNode);
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            
            // Return ordered fragments as well as snips container
            return [ ...fragments, chapter.snips ];
        }
        else if (data.ids.type === 'snip') {
            // Collect all the text fragements of the snip
            const snip = data as SnipNode;
            const fragments = [ ...snip.textData ];
            fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            return fragments;
        }
        else if (data.ids.type === 'root') {
            // Collect all chapters and snips
            const root = data as RootNode;
            
            // Simply return both of the container nodes for the root type
            return [ root.chapters, root.snips ];
        }
        else if (data.ids.type === 'container') {
            // Collect all the children of this container
            const container = data as ContainerNode;
            
            // Order the contents
            const contents = container.contents.map(td => td as unknown as OutlineNode);
            contents.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

            // Return ordered contents
            return contents;
        }
        else if (data.ids.type === 'fragment') {
            return [];
        }
        else {
            throw new Error(`Unexpected data type: '${data.ids.type}' in OutlineNode.getChildren`);
        }
    }

    async getDotConfigPath (): Promise<vscode.Uri | null> {
        if (this.data.ids.type === 'root') {
            return null;
        }
        else if (this.data.ids.type === 'container') {
            // Config file for a container is found at relativePath/.config
            const relative = this.getUri();
            return vscodeUris.Utils.joinPath(relative, `.config`);
        }
        else if (this.data.ids.type === 'chapter' || this.data.ids.type === 'snip' || this.data.ids.type === 'fragment') {
            const parentContainerUri = this.data.ids.parentUri;
            const parentConfigUri = vscodeUris.Utils.joinPath(parentContainerUri, '.config');
            return parentConfigUri;
        }
        else {
            throw new Error('Not possible');
        }
    }

    data: NodeTypes;

    constructor(data: NodeTypes) {
        super();
        this.data = data;
    }
}
