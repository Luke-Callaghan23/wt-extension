/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../vsconsole';
import { Workspace } from '../workspace/workspaceClass';
import { TODOData, TODONode } from './TODONode';
import { OutlineTreeProvider } from '../outlineProvider/outlineTreeProvider';
import { InitializeNode, initializeOutline } from '../outlineProvider/initialize';
import { Timed } from '../timedView';
import { OutlineNode } from '../outline/outlineNodes';
import { ChapterNode, ContainerNode, FragmentData, NodeTypes, RootNode, SnipNode } from '../outlineProvider/fsNodes';

export type TODO = {
	rowStart: number,
	rowEnd: number,
	colStart: number,
	colEnd: number,
	preview: string
};

export type Validation = {
	type: 'todos',
	data: TODO[] 
} | {
	type: 'count',
	data: number
} | {
	type: 'invalid'
};

type TODOInfo = { [index: string]: Validation };
export const todo: TODOInfo = {};

export const isInvalidated: (uri: string) => boolean = (uri: string) => {
	const todoLog = todo[uri];
	return !todoLog || todoLog.type === 'invalid';
};

export const getTODO = (uri: string): Validation => {
	const data = todo[uri];
	if (data.type === 'invalid') {
		vscode.window.showWarningMessage(`Error: uri was not validated before calling getTODO.  This is my fault.  Please message me and call me and idiot if you see this.`);
		throw new Error('Make sure to validate your uri before calling getTODO!');
	}
	return data;
};

export class TODOsView extends OutlineTreeProvider<TODONode> implements Timed {
	
	//#region outline tree provider
	disposables: vscode.Disposable[] = [];
    async initializeTree(): Promise<TODONode> {
		const init: InitializeNode<TODONode> = (data: NodeTypes<TODONode>) => new TODONode(data);
        return initializeOutline<TODONode>(init);
    }

    // Overriding the parent getTreeItem method to add FS API to it
	async getTreeItem(element: TODONode): Promise<vscode.TreeItem> {
		const treeItem = await super.getTreeItem(element);
		if (element.data.ids.type === 'fragment') {
			if (element.data.ids.type === 'fragment' && element.data.ids.parentTypeId === 'fragment') {
				// Fragments with an internal id of 'dummy' are TODO nodes
				// They store TODO data and when clicked they should open into the tree where
				//		the TODO string was found

				// Convert generic node data to a TODONode
				const asTODO: TODOData = element.data as TODOData;
				const todoData = asTODO.todo;

				treeItem.command = { 
					command: 'wt.todo.openFile', 
					title: "Open File", 
					// Pass the resource url to the fragment and the 
					arguments: [treeItem.resourceUri, todoData], 
				};
				treeItem.contextValue = 'file';
			}
			else {
				// Fragments whose internal ids are not 'dummy' are actual fragments
				// In the TODO tree, fragments are actually treated as folders, so 
				//		they cannot be clicked and opened like they can in the outline
				//		view
				treeItem.contextValue = 'dir';
				treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
			}
		}
		else if (element.data.ids.type === 'container') {
			treeItem.contextValue = 'container';
		}
		else {
			treeItem.contextValue = 'dir';
		}

		// Add the icon, depending on whether this node represents a folder or a text fragment
		const icon = element.data.ids.type === 'fragment'
			? 'edit'
			: 'symbol-folder';

		treeItem.iconPath = new vscode.ThemeIcon(icon);
		return treeItem;
	}

	
	_onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}
	//#endregion

    constructor(
        context: vscode.ExtensionContext, 
		protected workspace: Workspace
    ) {
        super(context, 'wt.todo');
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	}

	async init (): Promise<void> {
		await this._init();
		this.registerCommands();
		this.enabled = true;
	}

	//#region Timed methods
	enabled: boolean = false;
	async update (editor: vscode.TextEditor): Promise<void> {
		const document = editor.document;
		
		const editedFragmentUri: vscode.Uri = document.uri;
		const editedFragmentNode: TODONode | null = await this._getTreeElementByUri(editedFragmentUri);
		if (!editedFragmentNode) {
			this.tree = await initializeOutline((e) => new TODONode(e));
			this.refresh(this.tree);
		}

		let currentUri: vscode.Uri = editedFragmentUri;
		let currentNode: TODONode | null = editedFragmentNode;

		// Traverse upwards from the current node and invalidate it as well as all of its
		//		parents
		while (currentNode && currentUri) {
			// Invalidate the current node
			todo[currentUri.toString()] = { type: 'invalid' };
			
			// Break once the root node's records have been removed
			if (currentNode.data.ids.type === 'root') {
				break;
			}

			// Traverse upwards
			const parentUri = currentNode.data.ids.parentUri;
			currentNode = await this._getTreeElementByUri(parentUri);
			currentUri = currentNode?.getUri();
		}

		// // Refresh all invalidated nodes on the tree
		// this.tree = await initializeOutline((e) => new TODONode(e));
		this.refresh(this.tree);
	}

	async disable?(): Promise<void> {
		vscode.commands.executeCommand('wt.todo.refresh', true);
	}
	//#endregion

    // Register all the commands needed for the outline view to work
    registerCommands() {
        vscode.commands.registerCommand('wt.todo.openFile', (resourceUri: vscode.Uri, todoData: TODO) => {
			// Create a range object representing where the TODO lies on the document
			const textDocumentRange = new vscode.Range (
				todoData.rowStart,		// start line
				todoData.colStart,		// start character
				todoData.rowEnd,		// end line
				todoData.colEnd,		// end character
			);

			// Open the document
			vscode.window.showTextDocument(resourceUri, { selection: textDocumentRange });
		});

		vscode.commands.registerCommand('wt.todo.refresh', async () => {
			Object.getOwnPropertyNames(todo).forEach(uri => {
				todo[uri] = { type: 'invalid' };
			});
			this.tree = await initializeOutline((e) => new TODONode(e));
			this.refresh(this.tree);
		});

		vscode.commands.registerCommand('wt.todo.help', () => {
			vscode.window.showInformationMessage(`TODOs`, {
                modal: true,
                detail: `The TODO panel is an area that logs all areas you've marked as 'to do' in your work.  The default (and only (for now)) way to mark a TODO in your work is to enclose the area you want to mark with square brackets '[]'`
            }, 'Okay');
		});

		// Command for recieving an updated outline tree from the outline view --
		// Since the OutlineView handles A LOT of modification of its node tree, it's a lot easier
		//		to just emit changes from there over to here and then reflect the changes on this end
		//		rather than trying to make sure the two trees are always in sync with each other
		// `updated` is always the root node of the outline tree
		vscode.commands.registerCommand('wt.todo.updateTree', (updated: OutlineNode) => {
			this.tree.data.ids = { ...updated.data.ids };
			const outlineRoot = updated.data as RootNode<OutlineNode>;
			const outlineChapters = outlineRoot.chapters;
			const outlineWorkSnips = outlineRoot.snips;

			// Converts an array of fragment OutlineNodes to an array of TODONodes for those fragments
			const convertFragments = (fragments: OutlineNode[]): TODONode[] => {
				return fragments.map(outlineFragment => {
					return new TODONode(<FragmentData> {
						ids: { ...outlineFragment.data.ids },
						md: ''
					})
				})
			}

			// Converts a snip container OutlineNode into a snip container TODONode
			const convertSnips = (snips: OutlineNode) => {
				return new TODONode(<ContainerNode<TODONode>> {
					ids: { ...snips.data.ids },
					contents: (snips.data as ContainerNode<OutlineNode>).contents.map(outlineSnip => {
						return new TODONode(<SnipNode<TODONode>> {
							ids: { ...outlineSnip.data.ids },
							textData: convertFragments((outlineSnip.data as SnipNode<OutlineNode>).textData)
						})
					})
				})
			}

			// Converts a chapter container OutlineNode into a chapter container TODONode
			const convertChapters = (chapters: OutlineNode) => {
				return new TODONode(<ContainerNode<TODONode>> {
					ids: { ...chapters.data.ids },
					contents: (chapters.data as ContainerNode<OutlineNode>).contents.map(outlineChapter => {
						const chapter: ChapterNode<OutlineNode> = outlineChapter.data as ChapterNode<OutlineNode>;
						return new TODONode(<ChapterNode<TODONode>> {
							ids: { ...outlineChapter.data.ids },
							snips: convertSnips(chapter.snips),
							textData: convertFragments(chapter.textData)
						});
					})
				})
			}

			// Convert the outline's Outline nodes into TODO nodes and swap out the TODO tree's data
			//		with those converted nodes
			const todoRoot = this.tree.data as RootNode<TODONode>;
			todoRoot.chapters = convertChapters(outlineChapters);
			todoRoot.snips = convertSnips(outlineWorkSnips);
		});
    }

	async refresh(refreshRoot: TODONode): Promise<void> {
		// First create a new tree
		// try {
		// 	this.tree = await this.initializeTree();
		// }
		// catch (e) {
		// 	// If error occurs in initializing the tree, then dispose of this view
		// 	// (So that the outline view can return to the home screen)
		// 	this.view.dispose();
		// 	throw e;
		// }
		// Then update the root node of the outline view
		this.onDidChangeTreeData.fire(refreshRoot);
	}
}