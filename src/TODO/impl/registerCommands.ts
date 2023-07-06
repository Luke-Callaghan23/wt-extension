import * as vscode from 'vscode';
import { TODO, TODOsView, todo } from '../TODOsView';
import { initializeOutline } from '../../outlineProvider/initialize';
import { TODONode } from '../node';
import { OutlineNode } from '../../outline/node';
import { ChapterNode, ContainerNode, FragmentData, RootNode, SnipNode } from '../../outlineProvider/fsNodes';

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
        
        console.log('calling wt.todo.updateTree')
        
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