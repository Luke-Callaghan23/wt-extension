import * as vscode from 'vscode';
import * as extension from '../extension';
import * as vsconsole from './../vsconsole';

export interface HasGetUri {
    getUri(): vscode.Uri;
	getParentUri(): vscode.Uri;
	getChildren(filter: boolean, insertIntoNodeMap: (node: HasGetUri, uri: string)=>void): Promise<HasGetUri[]>;
}

export class UriBasedView<T extends HasGetUri> {
	protected uriToVisibility: { [index: string]: boolean } = {};
	public nodeMap: { [index: string]: T } = {};
    public rootNodes: T[];

	constructor () {
		this.rootNodes = [];
	}

    protected async initUriExpansion (viewName: string, view: vscode.TreeView<T>, context: vscode.ExtensionContext): Promise<void> {
		const uriMap: { [index: string]: boolean } | undefined = context.workspaceState.get(`${viewName}.collapseState`);
		if (uriMap) {
			this.uriToVisibility = uriMap;
		}
        
		// Functions for storing the state of a uri's collapse/expands whenever a tree is closed 
		//		or opened
		view.onDidExpandElement((event: vscode.TreeViewExpansionEvent<T>) => {
			const expandedElementUri = event.element.getUri();
			const usableUri = expandedElementUri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
			this.uriToVisibility[usableUri] = true;
			// Also save the state of all collapse and expands to workspace context state
			context.workspaceState.update(`${viewName}.collapseState`, this.uriToVisibility);
		});

		view.onDidCollapseElement((event: vscode.TreeViewExpansionEvent<T>) => {
			const collapsedElementUri = event.element.getUri();
			const usableUri = collapsedElementUri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
			this.uriToVisibility[usableUri] = false;			
			context.workspaceState.update(`${viewName}.collapseState`, this.uriToVisibility);
		});
    }
	
	// From the given nodes, filter out all nodes who's parent is already in the the array of Nodes.
	async getLocalRoots (nodes: T[]): Promise<T[]> {
		const localRoots: T[] = [];
		for (let i = 0; i < nodes.length; i++) {
			const parentId = nodes[i].getParentUri();
			const parent = await this.getTreeElementByUri(parentId);
			if (parent) {
				const isInList = nodes.find(n => n.getUri().toString() === parent.getUri().toString());
				if (isInList === undefined) {
					localRoots.push(nodes[i]);
				}
			} else {
				localRoots.push(nodes[i]);
			}
		}
		return localRoots;
	}
	

	async getTreeElementByUri (targetUri: vscode.Uri | undefined, tree?: T, filter?: boolean): Promise<any> {
		// If there is not targeted key, then assume that the caller is targeting
		//		the entire tree
		if (!targetUri) {
			return this.rootNodes;
		}
		
		if (!targetUri.fsPath.includes(extension.rootPath.fsPath)) {
			return null;
		}
	
		if (targetUri.fsPath in this.nodeMap) {
			vsconsole.log("Node map hit!");
			return this.nodeMap[targetUri.fsPath];
		}
		vsconsole.log(`Node map miss for target uri: ${targetUri.fsPath}`);
		
		const insertIntoNodeMap = (node: HasGetUri, uri: string) => {
			this.nodeMap[uri] = node as T;
		}
		
		// If there is no provided tree, use the whole tree as the search space
		const currentNodes = tree ? [tree] : this.rootNodes;
		for (const currentNode of currentNodes) {
			if (!currentNode) throw 'unreachable';
			if (!currentNode.getChildren) return null;
			const currentChildren = await currentNode.getChildren(!!filter, insertIntoNodeMap);
	
			if (currentNode.getUri().fsPath === targetUri.fsPath) {
				this.nodeMap[targetUri.fsPath] = currentNode;
				return currentNode as T;
			}
			// Iterate over all keys-value mappings in the current node
			for (const subtree of currentChildren) {
				const subtreeId = subtree.getUri().fsPath;
	
				// If the current key matches the targeted key, return the value mapping
				if (subtreeId === targetUri.fsPath) {
					this.nodeMap[targetUri.fsPath] = subtree as T;
					return subtree as T;
				} 
				// Otherwise, recurse into this function again, using the current
				//		subtree as the search space
				else {
					const treeElement = await this.getTreeElementByUri(targetUri, subtree as T, filter);
					
					// If the tree was found, return it
					if (treeElement) {
						this.nodeMap[targetUri.fsPath] = treeElement;
						return treeElement;
					}
				}
			}
		}

		return null;
	}
}