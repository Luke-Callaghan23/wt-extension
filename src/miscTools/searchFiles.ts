import * as vscode from 'vscode';
import { OutlineView } from './../outline/outlineView';
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from './../outline/nodes_impl/outlineNode';
import { ExtensionGlobals } from './../extension';
import { compareFsPath, showTextDocumentWithPreview } from './help';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import * as extension from '../extension';

export interface IFragmentPick {
    label: string;
    description?: string;
    node: OutlineNode;
    kind?: vscode.QuickPickItemKind;
    alwaysShow?: boolean;
}

export interface IButton extends vscode.QuickInputButton {
    iconPath: vscode.ThemeIcon,
    tooltip: string,
    id: 'filterButton' | 'clearFilters'
}

export type Predicate = ((node: OutlineNode)=>boolean);

export function getFilesQPOptions (bases: OutlineNode[], filterGeneric: boolean, prefix: string, predicateFilters?: Predicate[]): {
    options: IFragmentPick[],
    currentNode: OutlineNode | undefined,
    currentPick: IFragmentPick | undefined
} {
    const options: IFragmentPick[] = [];

    // 
    const currentDoc: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri;
    let currentNode: OutlineNode | undefined;
    let currentPick: IFragmentPick | undefined;

    // Get spaces before an option's text for the search menu
    // Need to determine if any given "column" of indents before the option text is "lined" or "spaced"
    // A column is lined when the parent item of that column is NOT the last item in its collection
    //      the line denotebook that there are more items to follow
    // When the item is the last item in its collection, then all lines down its path is not lined in that specific 
    //      column
    // `lastItemMarkers` --> array of booleans which say whether the item at each indent level is the last item in that path of the tree
    //      when an item at an indent level is the last item in the tree, we don't want to draw the line extending down from it
    //      anymore
    const giveMeSomeSpace = (lastItemMarkers: boolean[]): string => {
        const spaces: string[] = [];
        for (const isLastItem of lastItemMarkers) {
            const divideMearker = isLastItem ? ' ' : '│';
            spaces.push(divideMearker + ' '.repeat(TAB_SIZE));
        }
        return spaces.join('');
    }

    // If a tree item is the last item in its collection, then it has a corner character, otherwise it's a T
    const getTreeChar = (isLast: boolean): string => {
        return isLast ? '└' : '├';
    }



    // Function to create quick pick options for a snip and all of its children options
    const processSnip = (
        snipNode: OutlineNode, 
        path: string,
        lastItemMarkers: boolean[]
    ) => {
        if (predicateFilters && !predicateFilters.every(p => p(snipNode))) return;
        const snip = snipNode.data as SnipNode;

        // For the snip folder itelf, exclude the last item marker because the last item is inserted as a spacer for the child items
        const space = giveMeSomeSpace(lastItemMarkers.slice(0, lastItemMarkers.length-1));
        const treeChar = getTreeChar(lastItemMarkers[lastItemMarkers.length - 1]);

        // Create the folder for the current snip
        options.push({
            label: `${space}${treeChar}─$(folder) Snip: ${snip.ids.display}`,
            description: `(${path})`,
            node: snipNode,
        })

        const contentSpace = giveMeSomeSpace(lastItemMarkers);

        // Sort and create options for each content of this snip
        snip.contents.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
        snip.contents.forEach((content, contentIndex) => {
            const contentIsLast = contentIndex === snip.contents.length - 1;
            if (content.data.ids.type === 'fragment') {
                if (predicateFilters && !predicateFilters.every(p => p(content))) return;
                // Create the option for the current fragment child
                const fragmentTreeChar = getTreeChar(contentIsLast);
                options.push({
                    label: `${contentSpace}${fragmentTreeChar}─$(edit) ${content.data.ids.display}`,
                    description: `(${path}/${snip.ids.display})`,
                    node: content,
                });
                
                // If this fragment is the currently open document in the editor, then set `currentNode` and `currentPick`
                if (!currentNode && currentDoc && compareFsPath(content.data.ids.uri, currentDoc)) {
                    currentNode = content;
                    currentPick = options[options.length - 1];
                }
                // Otherwise, if we're filtering generic files (and this is a generic file), then pop the option from the queue
                else if (filterGeneric && content.data.ids.display.startsWith("Imported Fragment (") || content.data.ids.display.startsWith("New Fragment (")) {
                    options.pop();
                }
            }
            else if (content.data.ids.type === 'snip') {
                // If the content is a snip, then recurse into that snip
                processSnip(
                    content, 
                    `${path}/${snip.ids.display}`, 
                    [ ...lastItemMarkers, contentIsLast ]
                );
            };
        })
    }


    // Function to create quick pick options for all chapters and all of its children options
    const processChapter = (
        chapterNode: OutlineNode, 
        path: string,
        lastItemMarkers: boolean[],
    ) => {
        if (predicateFilters && !predicateFilters.every(p => p(chapterNode))) return;

        const chapter = chapterNode.data as ChapterNode;

        let fakeSpace = '';
        let fakeMarkers: boolean[] = [];
        if (path !== 'Base') {
            // Create "fake" spacing
            // Basically, we want all chapters to always have the first space to be a line instead of a space
            //      even the last chapter
            // To do this, just copy the existing spacing and set the first index to false 
            // In reality this is equivalent to `const fakeMarkers = [ false ];`
            fakeMarkers = [...lastItemMarkers];
            fakeMarkers[0] = false;
            fakeSpace = giveMeSomeSpace(fakeMarkers);        
        }

        // Also want to use the real spacing for the child items of this chapter, so get actual spacing
        const realSpace = giveMeSomeSpace(lastItemMarkers);

        // Chapter folder item
        const treeChar = getTreeChar(lastItemMarkers[lastItemMarkers.length - 1]);
        options.push({
            label: `${fakeSpace}${treeChar}─$(folder) Chapter: ${chapter.ids.display}`,
            description: `(${path})`,
            node: chapterNode
        });
        
        // Sort and create options for text fragments
        chapter.textData.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
        chapter.textData.forEach((fragment, fragmentIndex) => {
            if (predicateFilters && !predicateFilters.every(p => p(fragment))) return;

            // Create option for this fragment
            const fragmentTreeChar = getTreeChar(fragmentIndex === chapter.textData.length - 1);
            options.push({
                // Fake space followed by real space, because we always want the first column to be a line, but we want the second column to be 
                //      empty if this is the last chapter
                label: `${fakeSpace}${realSpace}${fragmentTreeChar}─$(edit) ${fragment.data.ids.display}`,
                description: `(${path}/${chapter.ids.display})`,
                node: fragment
            });

            // If this fragment is the currently open document in the editor, then set `currentNode` and `currentPick`
            if (!currentNode && currentDoc && compareFsPath(fragment.data.ids.uri, currentDoc)) {
                currentNode = fragment;
                currentPick = options[options.length - 1];
            }
            // Otherwise, if we're filtering generic files (and this is a generic file), then pop the option from the queue
            else if (filterGeneric && (
                fragment.data.ids.display.startsWith("Imported Fragment (") 
                || fragment.data.ids.display.startsWith("Imported Fragment (")
                || fragment.data.ids.display.startsWith("New Fragment (")
                || fragment.data.ids.display.startsWith("New Fragment")
            )) {
                options.pop();
            }
        });

        if (predicateFilters && !predicateFilters.every(p => p(chapter.snips))) return;
        // Snips folder
        options.push({
            // Fake space followed by real space, because we always want the first column to be a line, but we want the second column to be 
            //      empty if this is the last chapter
            label: `${fakeSpace}${realSpace}${getTreeChar(true)}─$(folder) ${chapter.snips.data.ids.display}`,
            description: `(${path}/${chapter.ids.display})`,
            node: chapter.snips
        });

        // Sort and create options for all of the snips of this chapter
        const snipContents = (chapter.snips.data as ContainerNode).contents;
        snipContents.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
        snipContents.forEach((snip, snipIndex) => {
            processSnip(
                snip, 
                `${path}/${chapter.ids.display}/Snips`,
                // Complicated why this is the correct sequence of markers.  Just don't touch.
                [ ...fakeMarkers, lastItemMarkers[lastItemMarkers.length-1], true, snipIndex === snipContents.length - 1 ]
            );
        })
    }

    const processRoot = (
        rootNode: OutlineNode, 
    ) => {
        const root = rootNode.data as RootNode;

        // =========================== CHAPTERS SECTION =========================== 
        /* Chapters Folder */ 
        if (!predicateFilters || predicateFilters.every(p => p(root.chapters))) {
            options.push({
                label: "$(folder) Chapters:",
                description: `(${prefix})`,
                node: root.chapters
            })
            // Sort and create options for chapters 
            const chapters = (root.chapters.data as ContainerNode).contents;
            chapters.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            chapters.forEach((chapter, chapterIndex) => {
                processChapter(
                    chapter, 
                    prefix.length > 0 ? `${prefix}/Chapters` : "Chapters",
                    [ chapterIndex === chapters.length - 1 ]
                );
            });
        }
        
        // =========================== WORK SNIPS SECTIONS =========================== 
        /* Work Snips Folder */ 
        if (!predicateFilters || predicateFilters.every(p => p(root.snips))) {
            options.push({
                label: "$(folder) Work Snips:",
                description: `(${prefix})`,
                node: root.snips
            });
            // Sort and create options for work snips
            const snips = (root.snips.data as ContainerNode).contents;
            snips.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            snips.forEach((snip, snipIndex) => {
                processSnip(
                    snip, 
                    prefix.length > 0 ? `${prefix}/Work Snips` : "Work Snips",
                    [ snipIndex === snips.length - 1 ]
                );
            });
        }
        // ===========================================================================
    }

    for (let baseIndex = 0; baseIndex < bases.length; baseIndex++) {
        const base = bases[baseIndex];
        if (base.data.ids.type === 'root') {
            processRoot(base);
        }
        else if (base.data.ids.type === 'chapter') {
            processChapter(base, prefix, [ baseIndex === bases.length - 1 ]);
        }
        else if (base.data.ids.type === 'snip') {
            processSnip(base, prefix, [ baseIndex === bases.length - 1 ]);
        }
        else if (base.data.ids.type === 'fragment') {
            // Create option for this fragment
            options.push({
                // Fake space followed by real space, because we always want the first column to be a line, but we want the second column to be 
                //      empty if this is the last chapter
                label: `${getTreeChar(baseIndex === bases.length - 1)}─$(edit) ${base.data.ids.display}`,
                description: `(${prefix})`,
                node: base
            });

            // If this fragment is the currently open document in the editor, then set `currentNode` and `currentPick`
            if (!currentNode && currentDoc && compareFsPath(base.data.ids.uri, currentDoc)) {
                currentNode = base;
                currentPick = options[options.length - 1];
            }
            // Otherwise, if we're filtering generic files (and this is a generic file), then pop the option from the queue
            else if (filterGeneric && base.data.ids.display.startsWith("Imported Fragment (") || base.data.ids.display.startsWith("New Fragment (")) {
                options.pop();
            }
        }
        else throw `Get QP Options not implemented for '${base.data.ids.type}' data type`;
    }

    return {
        options,
        currentNode,
        currentPick
    };
}

const TAB_SIZE: number = 4;
export async function searchFiles () {
    const fragment = await selectFragment();
    if (!fragment) return null;
    await showTextDocumentWithPreview(fragment.data.ids.uri);
}

export async function selectFragment (): Promise<OutlineNode | null> {
    const selected = await select([
        ExtensionGlobals.outlineView,
        ExtensionGlobals.scratchPadView,
        ExtensionGlobals.recyclingBinView,
    ], [], false, true);
    if (!selected || selected.length === 0) return null;
    return selected[0];
}


export async function selectFiles (this: UriBasedView<OutlineNode>, predicateFilters?: Predicate[]): Promise<OutlineNode[] | null> {
    return select(this, predicateFilters || [], true);
}

export async function selectFile (this: UriBasedView<OutlineNode>, predicateFilters?: Predicate[]): Promise<OutlineNode | null> {
    const result = await select(this, predicateFilters || [], false);
    if (result) {
        return result[0];
    }
    return null;
}

const viewSeparatorTitle = (prefix: string): IFragmentPick => ({
    label: prefix,
    node: new OutlineNode({
        ids: {
            type: 'root',
            display: prefix,
            fileName: "",
            ordering: 0,
            parentTypeId: 'root',
            parentUri: extension.rootPath,
            uri: extension.rootPath,
            relativePath: "",
        },
        contents: [],
    }),
    alwaysShow: false,
    description: `(${prefix})`,
    kind: vscode.QuickPickItemKind.Default,
});

const viewSeparatorLine = (prefix: string): IFragmentPick => ({
    label: prefix,
    //@ts-ignore
    node: null,
    alwaysShow: false,
    kind: vscode.QuickPickItemKind.Separator,
    description: `(${prefix})`,
})

async function select (
    viewOrViews: UriBasedView<OutlineNode>[] | UriBasedView<OutlineNode>, 
    predicateFilters: Predicate[], 
    allowMultiple: boolean,
    selectForFragment?: boolean
): Promise<OutlineNode[] | null> {
    const views = Array.isArray(viewOrViews)
        ? viewOrViews
        : [ viewOrViews ];

    const context = ExtensionGlobals.context;

    return new Promise((accept, reject) => {
        const qp = vscode.window.createQuickPick<IFragmentPick>();
        qp.canSelectMany = allowMultiple;
        qp.ignoreFocusOut = true;
        qp.matchOnDescription = true;
        qp.busy = true;

        qp.show();
        context.subscriptions.push(qp);
        
        const refreshInputs = () => {
            let allOptions: IFragmentPick[] = [];
            let currentFragmentPick: IFragmentPick | null = null;
            for (let index = 0; index < views.length; index++) {
                const view = views[index];

                allOptions.push(viewSeparatorLine(view.viewTitle));
                if (view !== ExtensionGlobals.outlineView) {
                    allOptions.push(viewSeparatorTitle(view.viewTitle));
                }

                const { options, currentNode, currentPick } = getFilesQPOptions(view.rootNodes, false, view.viewTitle, predicateFilters);
                currentFragmentPick = currentFragmentPick || currentPick || null;

                allOptions = allOptions.concat(options);
                if (index !== views.length - 1) {
                }
            }

            qp.busy = false;
            qp.items = allOptions;
            if (currentFragmentPick) {
                qp.activeItems = [ currentFragmentPick ];
                qp.value = `${currentFragmentPick.description?.slice(1, currentFragmentPick.description.length-1)}`
            } 
        }
        refreshInputs();
        

        const buttons: IButton[] = [ {
            iconPath: new vscode.ThemeIcon("filter"),
            tooltip: "Toggle Generic Fragment Names",
            id: 'filterButton',
        }, {
            iconPath: new vscode.ThemeIcon(""),
            tooltip: "Clear Filters",
            id: 'clearFilters'
        } ];
        qp.buttons = buttons;


        let isFiltering = true;
        //@ts-ignore
        context.subscriptions.push(qp.onDidTriggerButton((button: IButton) => {
            if (button.id === 'filterButton') {
                isFiltering = !isFiltering;
                qp.busy = true;
                refreshInputs();
            }
            else if (button.id === 'clearFilters') {
                isFiltering = false;
                qp.busy = true;
                refreshInputs();
                qp.value = ``
                qp.busy = false;
            }
        }));

        context.subscriptions.push(qp.onDidAccept(async () => {
            if (qp.selectedItems.length === 0) {
                accept(null);
                qp.dispose();
                return;
            }

            // Reveal the first node in the outline explorer
            const [ selected ] = qp.selectedItems;
            const selectedUri = selected.node.getUri();

            if ((selectForFragment && selected.node.data.ids.type === 'fragment') || !selectForFragment) {
                accept(qp.selectedItems.map(si => si.node))
                Promise.any(views.map(view => {
                    return new Promise<UriBasedView<OutlineNode>>((accept, reject) => {
                        return view.getTreeElementByUri(selectedUri).then(node => {
                            if (!node) return reject();
                            return accept(view);
                        });
                    });
                })).then(view => {
                    view.expandAndRevealOutlineNode(selected.node, {
                        expand: true,
                        select: true,
                    });
                });
                qp.dispose();
            }
            else {
                qp.busy = true;
                qp.value = `${selected.description?.slice(1, selected.description.length - 1)}/${selected.node.data.ids.display}`;
                qp.busy = false;
            }
        }));
    });
}