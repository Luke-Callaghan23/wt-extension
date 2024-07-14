import * as vscode from 'vscode';
import { TODO, TODOsView } from '../TODOsView';
import { initializeOutline } from '../../outlineProvider/initialize';
import { TODONode } from '../node';
import { OutlineNode } from '../../outline/nodes_impl/outlineNode';
import { ChapterNode, ContainerNode, FragmentNode, RootNode, SnipNode } from '../../outlineProvider/fsNodes';
import { DiskContextType } from '../../workspace/workspace';

export function registerCommands(this: TODOsView) {
    vscode.commands.registerCommand('wt.todo.openFile', async (resourceUri: vscode.Uri, todoData: TODO) => {
        // Create a range object representing where the TODO lies on the document
        const textDocumentRange = new vscode.Range (
            todoData.rowStart,		// start line
            todoData.colStart,		// start character
            todoData.rowEnd,		// end line
            todoData.colEnd,		// end character
        );

        // Open the document
        await vscode.window.showTextDocument(resourceUri, { selection: textDocumentRange });
    });

    vscode.commands.registerCommand('wt.todo.refresh', async (resource: TODONode | DiskContextType['wt.outline.collapseState'] | undefined | null) => {
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
    });

    vscode.commands.registerCommand('wt.todo.help', () => {
        vscode.window.showInformationMessage(`TODOs`, {
            modal: true,
            detail: `The TODO panel is an area that logs all areas you've marked as 'to do' in your work.  The default (and only (for now)) way to mark a TODO in your work is to enclose the area you want to mark with square brackets '[]'`
        }, 'Okay');
    });

    vscode.commands.registerCommand('wt.todo.getView', () => this);

    // Command for recieving an updated outline tree from the outline view --
    // Since the OutlineView handles A LOT of modification of its node tree, it's a lot easier
    //		to just emit changes from there over to here and then reflect the changes on this end
    //		rather than trying to make sure the two trees are always in sync with each other
    // `updated` is always the root node of the outline tree
    vscode.commands.registerCommand('wt.todo.updateTree', (arr: OutlineNode[], targets: OutlineNode[]) => {
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
        //		with those converted nodes
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
    });
}