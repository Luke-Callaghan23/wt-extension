/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import * as console from '../../../vsconsole';
import { OutlineTreeProvider, TreeNode } from '../outlineTreeProvider';
import { getLatestOrdering, readDotConfig, writeDotConfig } from '../../../help';
import { OutlineView } from './outlineView';
import * as fsNodes from '../fsNodes';
import * as extension from '../../../extension';
import { FileAccessManager } from '../../../fileAccesses';

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
    'chapter': [],
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
	getContainerParent (provider: OutlineTreeProvider<TreeNode>, secondary: string = 'root'): OutlineNode {
		// Traverse upwards until we find a 'chapter' or 'root' node
        // Both of these node types have a snips container within them that we can then use to store the new node
        let foundParent: OutlineNode;
        let parentId = this.data.ids.internal;
        while (true) {
            foundParent = provider._getTreeElement(parentId);
            if (foundParent.data.ids.type === secondary || foundParent.data.ids.type === 'chapter') {
                break;
            }
            parentId = foundParent.data.ids.parentInternalId;
        }

        // Convert the root or chapter parent to a more declarative type, and return the snips container
        return foundParent;
	}

    // Shifts all the nodes that 
    shiftTrailingNodesDown (view: OutlineTreeProvider<OutlineNode>): string {
        // Edit the old .config to remove the moved record
        const oldDotConfigRelativePath = this.getDotConfigPath(view as OutlineView);
        const oldDotConfigPath = `${extension.rootPath}/${oldDotConfigRelativePath}`;
        if (!oldDotConfigRelativePath) {
            vscode.window.showErrorMessage(`Error: could not find .config file at expected path '${oldDotConfigRelativePath}'.  Please do not mess with the file system of a IWE environment!`);
            throw new Error('Unable to retrieve .config path');
        }

        // Readh the .config
        const oldDotConfig = readDotConfig(oldDotConfigPath);
        if (!oldDotConfig) {
            vscode.window.showErrorMessage(`Error: could not read .config file at path '${oldDotConfigRelativePath}'.  Please do not mess with the file system of a IWE environment!`);
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
        writeDotConfig(oldDotConfigPath, oldDotConfig);
        return movedTitle;
    }

    moveNode (newParent: TreeNode, provider: OutlineTreeProvider<TreeNode>): boolean {
        const newParentNode = newParent as OutlineNode;
        const newParentType = newParentNode.data.ids.type;
        const newParentId = newParentNode.data.ids.internal;
        
        const moverType = this.data.ids.type;
        const moverParentId = this.data.ids.parentInternalId;
        
        const thisAllowedMoves = allowedMoves[moverType];
        if (!thisAllowedMoves.find(allowed => allowed === newParentType)) {
            return false;
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
            return moverContent.every(snip => snip.moveNode(containerTarget, provider));
        }

        // If the mover is not a container, then we're only moving a single item:

        let destinationContainer: NodeTypes;
        let moveFunc;
        if (moverType === 'snip') {
            // Use the root's .snips container
            if (newParentType === 'root') {
                const root: RootNode = (provider.tree as OutlineNode).data as RootNode;
                const workSnipsContainer: ContainerNode = (root.snips as OutlineNode).data as ContainerNode;
                destinationContainer = workSnipsContainer;
            }
            // Use the chapter's .snips container
            else if (newParentType === 'chapter') {
                const chapterNode: ChapterNode = provider._getTreeElement(newParentId).data;
                const chapterSnipsContainer: ContainerNode = chapterNode.snips.data as ContainerNode;
                destinationContainer = chapterSnipsContainer;
            }
            // Traverse upwards until we find the nearest 'root' or 'chapter' node that we can move the snip into
            else if (newParentType === 'snip' || newParentType === 'container' || newParentType === 'fragment') {
                const parentContainerNode = newParentNode.getContainerParent(provider).data as ChapterNode | RootNode;
                const parentSnipsContainer: ContainerNode = parentContainerNode.snips.data as ContainerNode;
                destinationContainer = parentSnipsContainer;
            }
            else {
                throw new Error('Not possible');
            }
            moveFunc = fs.renameSync;
        }
        else if (moverType === 'fragment') {
            if (newParentType === 'chapter' || newParentType === 'snip') {
                destinationContainer = provider._getTreeElement(newParentId).data;
            }
            else if (newParentType === 'fragment') {
                destinationContainer = newParentNode.getContainerParent(provider, 'snip').data;;
            }
            else {
                throw new Error('Not possible.');
            }
            moveFunc = fsExtra.moveSync;
        }  
        else {
            vscode.window.showErrorMessage('Not implemented');
            return false;
        }

        // Check to make sure that this snip is not already placed in this chapter
        if (destinationContainer.ids.internal === moverParentId) {
            vscode.window.showWarningMessage('WARN: did not move snip as it was already in the correct location');
            return false;
        }
        
        // Path for the old config file and old file
        const moverAbsPath = `${extension.rootPath}/${this.data.ids.relativePath}/${this.data.ids.fileName}`;

        // Path for the new fragment, and its new .config file
        const destinationRelativePath = `${extension.rootPath}/${destinationContainer.ids.relativePath}/${destinationContainer.ids.fileName}`;
        const destinationDotConfigPath = `${destinationRelativePath}/.config`;
        const destinationAbsPath = `${destinationRelativePath}/${this.data.ids.fileName}`;

        try {

            // Edit the new .config to add the moved record
            const destinationDotConfig = readDotConfig(destinationDotConfigPath);
            if (!destinationDotConfig) return false;

            // Find the record in the new .config file with the highest ordering
            const latestFragmentNumber = getLatestOrdering(destinationDotConfig);
            const movedFragmentNumber = latestFragmentNumber + 1;

            const movedRecordTitle = this.shiftTrailingNodesDown(provider as OutlineTreeProvider<OutlineNode>);
            if (movedRecordTitle === '') {
                return false;
            }

            // Add the record for the moved fragment to the new .config file and write to disk
            destinationDotConfig[this.data.ids.fileName] = {
                title: movedRecordTitle,
                ordering: movedFragmentNumber
            };
            writeDotConfig(destinationDotConfigPath, destinationDotConfig);

            // Finally move data with the move function specified above
            moveFunc(moverAbsPath, destinationAbsPath);

            return true;
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error: unable to move fragment file: ${e}`);
            return false;
        }
    }

    getParentId(): string {
        return this.data.ids.parentInternalId;
    }
    getTooltip (): string | vscode.MarkdownString {
        return `${this.data.ids.type} | actual name: ${this.getUri()}`;
    }
    
    hasChildren (): boolean {
        return this.data.ids.type !== 'fragment';
    }

    getUri(): vscode.Uri {
        return vscode.Uri.file(`${extension.rootPath}/${this.data.ids.relativePath}/${this.data.ids.fileName}`);
    }
    getDisplayString (): string {
        return this.data.ids.display;
    }

    getChildren (): OutlineNode[] {
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
    
    getId(): string {
        return this.data.ids.internal;
    }

    getDotConfigPath (outlineView: OutlineView): string | null {
        if (this.data.ids.type === 'root') {
            return null;
        }
        else if (this.data.ids.type === 'container') {
            // Config file for a container is found at relativePath/.config
            const relative = this.getUri();
            return `${relative}/.config`;
        }
        else if (this.data.ids.type === 'chapter' || this.data.ids.type === 'snip' || this.data.ids.type === 'fragment') {
            // Get the parent 'container' of this node
            const parentContainerId = this.data.ids.parentInternalId;
            const parentContainerNode: OutlineNode | null = outlineView._getTreeElement(parentContainerId);
            if (!parentContainerNode) {
                return null;
            }

            return `${parentContainerNode.data.ids.relativePath}/${parentContainerNode.data.ids.fileName}/.config`;
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
