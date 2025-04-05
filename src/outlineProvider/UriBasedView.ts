import * as vscode from 'vscode';
import * as extension from '../extension';
import * as vsconsole from '../miscTools/vsconsole';
import { compareFsPath, getFsPathKey, isSubdirectory, setFsPathKey } from '../miscTools/help';
import * as search from './../miscTools/searchFiles';
import * as vscodeUri from 'vscode-uri';

export interface HasGetUri {
    getUri(): vscode.Uri;
	getParentUri(): vscode.Uri | null;
	getChildren(filter: boolean, insertIntoNodeMap: (node: HasGetUri, uri: vscode.Uri)=>void): Promise<HasGetUri[]>;
}

export class UriBasedView<T extends HasGetUri> {
	protected uriToVisibility: { [index: string]: boolean } = {};
	public nodeMap: { [index: string]: T } = {};
    public rootNodes: T[];

	public view: vscode.TreeView<T>;
	public viewTitle: string;

	constructor (viewTitle: string) {
		this.rootNodes = [];
		this.view = {} as vscode.TreeView<T>;
		this.viewTitle = viewTitle;
	}

    protected async initUriExpansion (viewName: string, view: vscode.TreeView<T>, context: vscode.ExtensionContext): Promise<void> {
		const uriMap: { [index: string]: boolean } | undefined = context.workspaceState.get(`${viewName}.collapseState`);
		if (uriMap) {
			this.uriToVisibility = uriMap;
		}
        
		// Functions for storing the state of a uri's collapse/expands whenever a tree is closed 
		//		or opened
		context.subscriptions.push(view.onDidExpandElement((event: vscode.TreeViewExpansionEvent<T>) => {
			const expandedElementUri = event.element.getUri();
			const usableUri = expandedElementUri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
			this.uriToVisibility[usableUri] = true;
			// Also save the state of all collapse and expands to workspace context state
			context.workspaceState.update(`${viewName}.collapseState`, this.uriToVisibility);
		}));

		context.subscriptions.push(view.onDidCollapseElement((event: vscode.TreeViewExpansionEvent<T>) => {
			const collapsedElementUri = event.element.getUri();
			const usableUri = collapsedElementUri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
			this.uriToVisibility[usableUri] = false;			
			context.workspaceState.update(`${viewName}.collapseState`, this.uriToVisibility);
		}));
    }
	
	// From the given nodes, filter out all nodes who's parent is already in the the array of Nodes.
	async getLocalRoots (nodes: T[]): Promise<T[]> {
		const localRoots: T[] = [];
		for (let i = 0; i < nodes.length; i++) {
			const parentId = nodes[i].getParentUri();
			if (!parentId) continue;
			const parent = await this.getTreeElementByUri(parentId);
			if (parent) {
				const isInList = nodes.find(n => compareFsPath(n.getUri(), parent.getUri()));
				if (isInList === undefined) {
					localRoots.push(nodes[i]);
				}
			} else {
				localRoots.push(nodes[i]);
			}
		}
		return localRoots;
	}

	async getTreeElementByUri (targetUri: vscode.Uri | undefined, tree?: T, targetIsBasename?: boolean): Promise<T | null> {
		if (this.rootNodes.length === 0) {
			return null;
		}
		
		// If there is not targeted key, then assume that the caller is targeting
		//		the entire tree
		if (!targetUri || compareFsPath(targetUri, this.rootNodes[0].getUri())) {
			vsconsole.log(`[${this.constructor.name}] Root node hit!`);
			return this.rootNodes[0];
		}
		
		if (!targetUri.fsPath.includes(extension.rootPath.fsPath) && !targetIsBasename) {
			return null;
		}

		const cachedNode = getFsPathKey<T>(targetUri, this.nodeMap);
		if (cachedNode) {
			vsconsole.log(`[${this.constructor.name}] Node map hit!`);
			return cachedNode;
		}
		vsconsole.log(`[${this.constructor.name}] Node map miss for target uri: ${targetUri}`);
		
		const insertIntoNodeMap = (node: HasGetUri, uri: vscode.Uri) => {
			setFsPathKey<T>(uri, node as T, this.nodeMap);
		}
		
		// If there is no provided tree, use the whole tree as the search space
		const currentNodes = tree ? [tree] : this.rootNodes;
		for (const currentNode of currentNodes) {
			if (!currentNode) throw 'unreachable';
			if (!currentNode.getChildren) return null;
			if (!isSubdirectory(currentNode.getUri(), targetUri) && !targetIsBasename) continue;
			const currentChildren = await currentNode.getChildren(false, insertIntoNodeMap);
	
			const found = targetIsBasename
				? vscodeUri.Utils.basename(targetUri) === vscodeUri.Utils.basename(currentNode.getUri())
				: compareFsPath(currentNode.getUri(), targetUri)
			if (found) {
				setFsPathKey(targetUri, currentNode, this.nodeMap);
				return currentNode as T;
			}
			// Iterate over all keys-value mappings in the current node
			for (const subtree of currentChildren) {
				const subtreeId = subtree.getUri();
				
				// If the current key matches the targeted key, return the value mapping
				if (compareFsPath(subtreeId, targetUri)) {
					setFsPathKey(targetUri, subtree, this.nodeMap);
					return subtree as T;
				}
				// Otherwise, recurse into this function again, using the current
				//		subtree as the search space
				if (!isSubdirectory(subtree.getUri(), targetUri) && !targetIsBasename) continue;
				const treeElement = await this.getTreeElementByUri(targetUri, subtree as T, targetIsBasename);
				
				// If the tree was found, return it
				if (treeElement) {
					setFsPathKey(targetUri, treeElement, this.nodeMap);
					return treeElement;
				}
			}
		}

		return null;
	}

	selectFile = search.selectFile;
	selectFiles = search.selectFiles;
}