/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
// import * as console from '../vsconsole';
import { DiskContextType, Workspace } from '../workspace/workspaceClass';
import { TODOData, TODONode } from './node';
import { OutlineTreeProvider } from '../outlineProvider/outlineTreeProvider';
import { InitializeNode, initializeOutline } from '../outlineProvider/initialize';
import { Timed } from '../timedView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { ChapterNode, ContainerNode, FragmentNode, NodeTypes, RootNode, SnipNode } from '../outlineProvider/fsNodes';
import { update } from './impl/timerFunctions';
import { disable } from '../wordWatcher/timer';
import { registerCommands } from './impl/registerCommands';
import { getTODOCounts } from './nodes_impl/getTODOCounts';
import { getFsPathKey, setFsPathKey } from '../miscTools/help';
import { Extension } from   './../extension';

export type TODO = {
    rowStart: number;
    rowEnd: number;
    colStart: number;
    colEnd: number;
    preview: string;

    location: vscode.Location;
    surroundingText: string;
    surroundingTextHighlight: [ number, number ];
    largerSurrounding: string;
    largerSurroundingHighlight: [ number, number ];
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
// export const todo: TODOInfo = {};

export class TODOsView extends OutlineTreeProvider<TODONode> implements Timed {
    
    static todo: TODOInfo = {};
    isInvalidated = (uri: vscode.Uri): boolean => {
        const todoLog = getFsPathKey<Validation>(uri, TODOsView.todo);;
        return !todoLog || todoLog.type === 'invalid';
    };
    
    static getTODO = (uri: vscode.Uri): Validation => {
        const data = getFsPathKey<Validation>(uri, this.todo)!;
        if (data.type === 'invalid') {
            vscode.window.showWarningMessage(`Error: uri was not validated before calling getTODO.  This is my fault.  Please message me and call me and idiot if you see this.`);
            throw new Error('Make sure to validate your uri before calling getTODO!');
        }
        return data;
    };
    
    async invalidateNode (
        invalidate: vscode.Uri
    ) {
        const pathsToInvalidate: vscode.Uri[] = [];
    
        const root = Extension.rootPath;
        const relativePath = invalidate.fsPath.replace(root.fsPath, '');
        const elets = relativePath.split(/\\|\//).filter(s => s.length > 0);
        let running = root;
        for (const elt of elets) {
            running = vscode.Uri.joinPath(running, elt);
            setFsPathKey<Validation>(running, { type: 'invalid' }, TODOsView.todo);
        }
        pathsToInvalidate.forEach(currentUri => setFsPathKey<Validation>(currentUri, { type: 'invalid' }, TODOsView.todo));
    }

    static async clearTodos () {
        for (const key of Object.keys(TODOsView.todo)) {
            delete TODOsView.todo[key];
        }
    }
    
    enabled: boolean = false;
    update = update;
    disable = disable;

    //#region outline tree provider
    disposables: vscode.Disposable[] = [];
    async initializeTree(): Promise<TODONode> {
        const init: InitializeNode<TODONode> = (data: NodeTypes<TODONode>) => new TODONode(data);
        return initializeOutline<TODONode>(TODOsView.viewId, init);
    }

    async refresh(reload: boolean, updates: TODONode[]): Promise<void> {
        if (reload) {
            this.rootNodes = [await this.initializeTree()];
        }
        const todo = TODOsView.todo;
        console.log(todo);
        await this.rootNodes[0].getTODOCounts();
        return this._onDidChangeTreeData.fire(undefined);
    }

    // Overriding the parent getTreeItem method to add FS API to it
    async getTreeItem(element: TODONode): Promise<vscode.TreeItem> {
        const treeItem = await super.getTreeItem(element);
        if (element.data.ids.type === 'fragment') {
            if (element.data.ids.type === 'fragment' && element.data.ids.parentTypeId === 'fragment') {
                // Fragments with an internal id of 'dummy' are TODO nodes
                // They store TODO data and when clicked they should open into the tree where
                //        the TODO string was found

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
                //        they cannot be clicked and opened like they can in the outline
                //        view
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
        let icon: string;
        let color: vscode.ThemeColor | undefined;
        if (element.data.ids.type === 'fragment') {
            // Actual todos should not have the markdown symbol, so if parent is fragment use the pencil symbol
            if (element.data.ids.parentTypeId === 'fragment' || element.data.ids.uri.fsPath.toLocaleLowerCase().endsWith(".wt")) {
                icon = 'edit';
            }
            // Only markdown file, not todos should have the markdown symbol
            else {
                icon = 'markdown';
                color = new vscode.ThemeColor('button.background');
            }
        }
        else {
            icon = 'symbol-folder';
        }

        treeItem.iconPath = new vscode.ThemeIcon(icon, color);
        return treeItem;
    }

    
    _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
    get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
        return this._onDidChangeFile.event;
    }
    //#endregion

    // Register all the commands needed for the outline view to work
    registerCommands = registerCommands;

    static viewId: string = 'wt.todo';
    constructor(context: vscode.ExtensionContext, protected workspace: Workspace) {
        super(context, TODOsView.viewId, "TODO");
        this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        this.context.subscriptions.push(this._onDidChangeFile);
    }
    
    getUpdatesAreVisible(): boolean {
        return this.view.visible;
    }

    public async refreshView (resource?: TODONode | DiskContextType['wt.outline.collapseState'] | undefined | null) {
        Object.getOwnPropertyNames(TODOsView.todo).forEach(uri => {
            TODOsView.todo[uri] = { type: 'invalid' };
        });


        // If every entry in the resouce argument is a string -> boolean mapping then we can assume the resource is the collapse
        //      state mapping table
        const argIsCollapseState = resource && Object.entries(resource).every(([ key, val ]) => {
            return typeof key === 'string' && typeof val === 'boolean';
        });
        if (argIsCollapseState) {
            // Combine current uri visibility with the previous, inserting the old values and then
            //      the new values (so if there is any collisions the new states override the
            //      old ones)
            const collapseState = resource as DiskContextType['wt.outline.collapseState'];
            this.uriToVisibility = {
                ...this.uriToVisibility,
                ...collapseState
            };
        }

        // Refresh command involves ambiguous changes to TODO tree structure
        //      so should reload the tree fully from disk
        this.refresh(true, []);
    }

    
    // Command for recieving an updated outline tree from the outline view --
    // Since the OutlineView handles A LOT of modification of its node tree, it's a lot easier
    //        to just emit changes from there over to here and then reflect the changes on this end
    //        rather than trying to make sure the two trees are always in sync with each other
    // `updated` is always the root node of the outline tree
    public updateTree (arr: OutlineNode[], targets: OutlineNode[]) {
        const updated = arr[0];
        this.rootNodes[0].data.ids = { ...updated.data.ids };
            
        const outlineRoot = updated.data as RootNode<OutlineNode>;
        const outlineChapters = outlineRoot.chapters;
        const outlineWorkSnips = outlineRoot.snips;

        // Converts an array of fragment OutlineNodes to an array of TODONodes for those fragments
        const convertFragments = (fragments: OutlineNode[]): TODONode[] => {
            return fragments.map(outlineFragment => {
                return new TODONode(<FragmentNode> {
                    ids: { ...outlineFragment.data.ids },
                    md: ''
                })
            })
        }

        // Converts a snip container OutlineNode into a snip container TODONode
        const convertSnips = (snips: OutlineNode[]): TODONode[] => {
            return snips.map(outlineSnip => {
                return new TODONode(<SnipNode<TODONode>> {
                    ids: { ...outlineSnip.data.ids },
                    contents: (outlineSnip.data as SnipNode<OutlineNode>).contents.map(outlineNode => {
                        if (outlineNode.data.ids.type === 'fragment') {
                            return convertFragments([ outlineNode ])[0];
                        }
                        else if (outlineNode.data.ids.type === 'snip') {
                            return convertSnips([outlineNode])[0];
                        }
                        else throw 'unreachable';
                    })
                })
            });
        }

        // Converts a chapter container OutlineNode into a chapter container TODONode
        const convertChapters = (chapters: OutlineNode) => {
            return new TODONode(<ContainerNode<TODONode>> {
                ids: { ...chapters.data.ids },
                contents: (chapters.data as ContainerNode<OutlineNode>).contents.map(outlineChapter => {
                    const chapter: ChapterNode<OutlineNode> = outlineChapter.data as ChapterNode<OutlineNode>;
                    return new TODONode(<ChapterNode<TODONode>> {
                        ids: { ...outlineChapter.data.ids },
                        textData: convertFragments(chapter.textData),
                        snips: new TODONode(<ContainerNode<TODONode>> {
                            ids: { ...chapter.snips.data.ids },
                            contents: convertSnips((chapter.snips.data as SnipNode<OutlineNode>).contents),
                        })
                    });
                })
            })
        }

        // Convert the outline's Outline nodes into TODO nodes and swap out the TODO tree's data
        //        with those converted nodes
        if (this.rootNodes[0].data) {
            (this.rootNodes[0].data as RootNode<TODONode>).chapters = convertChapters(outlineChapters);
            (this.rootNodes[0].data as RootNode<TODONode>).snips = new TODONode(<ContainerNode<TODONode>> {
                ids: { ...outlineWorkSnips.data.ids },
                contents: convertSnips((outlineWorkSnips.data as SnipNode<OutlineNode>).contents),
            })
            targets.forEach(target => {
                this.invalidateNode(target.data.ids.uri);
            })
            this.refresh(false, []);
        }
    }

    async init (): Promise<void> {
        await this._init();
        this.registerCommands();
        this.enabled = false;
    }
}