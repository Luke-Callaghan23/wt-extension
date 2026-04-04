import * as vscode from 'vscode';
import { OutlineView } from './../outline/outlineView';
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from './../outline/nodes_impl/outlineNode';
import { ExtensionGlobals } from './../extension';
import { compareFsPath, formatFsPathForCompare, showTextDocumentWithPreview, stripDiacritics, UriFsPathFormatted, vagueNodeSearch } from './help';
import { UriBasedView } from '../outlineProvider/UriBasedView';
import * as extension from '../extension';

export interface IFragmentPick {
    label: string;
    description?: string;
    node: OutlineNode;
    detail?: string;
    kind?: vscode.QuickPickItemKind;
    alwaysShow?: boolean;
}

export interface IButton extends vscode.QuickInputButton {
    iconPath: vscode.ThemeIcon,
    tooltip: string,
    id: 'filterButton' | 'clearFilters'
}

export type Predicate = ((node: OutlineNode, qpItem: IFragmentPick)=>boolean);

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
    const getTreeChars = (isLast: boolean, hasDescription: boolean): [string, string] => {
        if (!hasDescription) {
            return [
                isLast ? '└' : '├',
                ''
            ];
        }
        else {
            if (isLast) {
                return [
                    '├', 
                    '└'
                ]
            }
            else {
                return [
                    '├',
                    '│',
                ];
            }
        }
    }

    // Function to create quick pick options for a snip and all of its children options
    const processSnip = (
        snipNode: OutlineNode, 
        path: string,
        lastItemMarkers: boolean[]
    ) => {
        const snip = snipNode.data as SnipNode;
        
        // For the snip folder itelf, exclude the last item marker because the last item is inserted as a spacer for the child items
        const space = giveMeSomeSpace(lastItemMarkers.slice(0, lastItemMarkers.length-1));
        const treeChars = getTreeChars(lastItemMarkers[lastItemMarkers.length - 1], !!snip.ids.description);

        // Create the folder for the current snip
        const qpItem: IFragmentPick = {
            label: `${space}${treeChars[0]}─$(folder) Snip: ${snip.ids.display}`,
            description: `(${path})`,
            node: snipNode,
            // alwaysShow: true,
            detail: snip.ids.description && `${space}${treeChars[1]}${snip.contents.length > 0 ? (' '.repeat(TAB_SIZE) + "│") : ""}  ${snip.ids.description}`,
        };

        if (predicateFilters && !predicateFilters.every(p => p(snipNode, qpItem))) return;
        options.push(qpItem);
        const contentSpace = giveMeSomeSpace(lastItemMarkers);

        // Sort and create options for each content of this snip
        snip.contents.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
        snip.contents.forEach((content, contentIndex) => {
            const contentIsLast = contentIndex === snip.contents.length - 1;
            if (content.data.ids.type === 'fragment') {
                // Create the option for the current fragment child
                const fragmentTreeChar = getTreeChars(contentIsLast, !!content.data.ids.description);
                const qpItem: IFragmentPick = {
                    label: `${contentSpace}${fragmentTreeChar[0]}─$(edit) ${content.data.ids.display}`,
                    description: `(${path}/${snip.ids.display})`,
                    node: content,
                    // alwaysShow: true,
                    detail: content.data.ids.description && `${contentSpace}${fragmentTreeChar[1]}   ${content.data.ids.description}`,
                }
                
                if (predicateFilters && !predicateFilters.every(p => p(content, qpItem))) return;
                options.push(qpItem);
                
                // If this fragment is the currently open document in the editor, then set `currentNode` and `currentPick`
                if (!currentNode && currentDoc && compareFsPath(content.data.ids.uri, currentDoc)) {
                    currentNode = content;
                    currentPick = options[options.length - 1];
                }
                // Otherwise, if we're filtering generic files (and this is a generic file), then pop the option from the queue
                else if (filterGeneric && (content.data.ids.display.startsWith("Imported Fragment (") || content.data.ids.display.startsWith("New Fragment ("))) {
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
        const treeChar = getTreeChars(lastItemMarkers[lastItemMarkers.length - 1], !!chapter.ids.description);
        const qpItemChaptersFolder: IFragmentPick = {
            label: `${fakeSpace}${treeChar[0]}─$(folder) Chapter: ${chapter.ids.display}`,
            description: `(${path})`,
            node: chapterNode,
            // alwaysShow: true,
            detail: chapter.ids.description && `${fakeSpace}${treeChar[1]}${' '.repeat(TAB_SIZE) + "│"}   ${chapter.ids.description}`,
        };

        if (predicateFilters && !predicateFilters.every(p => p(chapterNode, qpItemChaptersFolder))) return;
        options.push(qpItemChaptersFolder);
        
        // Sort and create options for text fragments
        chapter.textData.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
        chapter.textData.forEach((fragment, fragmentIndex) => {
            
            // Create option for this fragment
            const fragmentTreeChar = getTreeChars(fragmentIndex === chapter.textData.length - 1, !!fragment.data.ids.description);
            const qpItem: IFragmentPick = {
                // Fake space followed by real space, because we always want the first column to be a line, but we want the second column to be 
                //      empty if this is the last chapter
                label: `${fakeSpace}${realSpace}${fragmentTreeChar[0]}─$(edit) ${fragment.data.ids.display}`,
                description: `(${path}/${chapter.ids.display})`,
                node: fragment,
                // alwaysShow: true,
                detail: fragment.data.ids.description && `${fakeSpace}${realSpace}${fragmentTreeChar[1]}   ${fragment.data.ids.description}`,
            };
            
            if (predicateFilters && !predicateFilters.every(p => p(fragment, qpItem))) return;
            options.push(qpItem);

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

        const chapterSnipsTreeChars = getTreeChars(true, !!chapter.snips.data.ids.description);

        // Snips folder
        const qpItemSnipsFolder: IFragmentPick = {
            // Fake space followed by real space, because we always want the first column to be a line, but we want the second column to be 
            //      empty if this is the last chapter
            
            label: `${fakeSpace}${realSpace}${chapterSnipsTreeChars[0]}─$(folder) ${chapter.snips.data.ids.display}`,
            description: `(${path}/${chapter.ids.display})`,
            node: chapter.snips,
            // alwaysShow: true,
            detail: chapter.snips.data.ids.description && `${fakeSpace}${realSpace}${chapterSnipsTreeChars[1]}    ${chapter.snips.data.ids.description}`,
        };
        if (predicateFilters && !predicateFilters.every(p => p(chapter.snips, qpItemSnipsFolder))) return;
        options.push(qpItemSnipsFolder);

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
        const qpItemChaptersFolder: IFragmentPick = {
            label: "$(folder) Chapters:",
            description: `(${prefix})`,
            node: root.chapters,
            // alwaysShow: true,
            detail: root.chapters.data.ids.description && `${root.chapters.data.ids.description}`,
        }; 
        if (!predicateFilters || predicateFilters.every(p => p(root.chapters, qpItemChaptersFolder))) {
            options.push(qpItemChaptersFolder);
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
        const qpItemWorkSnipsFolder: IFragmentPick = {
            label: "$(folder) Work Snips:",
            description: `(${prefix})`,
            node: root.snips,
            // alwaysShow: true,
            detail: root.snips.data.ids.description && `${root.snips.data.ids.description}`,
        }; 
        if (!predicateFilters || predicateFilters.every(p => p(root.snips, qpItemWorkSnipsFolder))) {
            options.push(qpItemWorkSnipsFolder);
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
            const space = getTreeChars(baseIndex === bases.length - 1, !!base.data.ids.description);
            // Create option for this fragment
            options.push({
                // Fake space followed by real space, because we always want the first column to be a line, but we want the second column to be 
                //      empty if this is the last chapter
                label: `${space[0]}─$(edit) ${base.data.ids.display}`,
                description: `(${prefix})`,
                node: base,
                // alwaysShow: true,
                detail: base.data.ids.description && `${space[1]}${base.data.ids.description}`,
            });

            // If this fragment is the currently open document in the editor, then set `currentNode` and `currentPick`
            if (!currentNode && currentDoc && compareFsPath(base.data.ids.uri, currentDoc)) {
                currentNode = base;
                currentPick = options[options.length - 1];
            }
            // Otherwise, if we're filtering generic files (and this is a generic file), then pop the option from the queue
            else if (filterGeneric && (base.data.ids.display.startsWith("Imported Fragment (") || base.data.ids.display.startsWith("New Fragment ("))) {
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
        qp.ignoreFocusOut = false;
        qp.matchOnDescription = true;
        qp.matchOnDetail = true;
        qp.busy = true;

        qp.show();
        context.subscriptions.push(qp);
        
        const refreshInputs = (refreshOptions?: {
            newPredicates?: Predicate[],
            onlyReturnItems?: boolean            // Only return items, DO NOT update qp state
        }): IFragmentPick[] => {
            let allOptions: IFragmentPick[] = [];
            let currentFragmentPick: IFragmentPick | null = null;
            for (let index = 0; index < views.length; index++) {
                const view = views[index];

                allOptions.push(viewSeparatorLine(view.viewTitle));
                if (view !== ExtensionGlobals.outlineView) {
                    allOptions.push(viewSeparatorTitle(view.viewTitle));
                }

                let currentPredicates = predicateFilters;
                if (refreshOptions?.newPredicates) {
                    currentPredicates = [
                        ...predicateFilters,
                        ...refreshOptions?.newPredicates
                    ];
                }

                const { options, currentNode, currentPick } = getFilesQPOptions(view.rootNodes, false, view.viewTitle, currentPredicates);
                currentFragmentPick = currentFragmentPick || currentPick || null;

                allOptions = allOptions.concat(options);
                if (index !== views.length - 1) {
                }
            }

            if (refreshOptions?.onlyReturnItems) {
                return allOptions;
            }

            qp.busy = false;
            qp.items = allOptions;
            if (currentFragmentPick) {
                qp.activeItems = [ currentFragmentPick ];
                qp.value = `${currentFragmentPick.description?.slice(1, currentFragmentPick.description.length-1)}`
            } 
            return allOptions;
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
                    if (view.view.visible) {
                        view.expandAndRevealOutlineNode(selected.node, {
                            expand: true,
                            select: true,
                        });
                    }
                });
                qp.dispose();
            }
            else {
                qp.busy = true;
                qp.value = `${selected.description?.slice(1, selected.description.length - 1)}/${selected.node.data.ids.display}`;
                qp.busy = false;
            }
        }));

        // Related to https://github.com/microsoft/vscode/issues/73904
        // This is custom filtering on the OutlineView to not only include nodes with the filter string,
        //      but also include all parents of those nodes as well and order them in a way that visually 
        //      makes sense
        // But, since VSCode overrides your custom sorting to put those with a better match to the qp.value string
        //      by default, there is no point in using this implementation yet
        // context.subscriptions.push(qp.onDidChangeValue(async (searchValue: string) => {
        //     const cleanSearch = stripDiacritics(searchValue);

        //     // TODO: create a master list of IFragmentPick[] at the start of processing
        //     //      and keep reusing that, instead of re-calculating the inputs every time
        //     const currentItems = refreshInputs({
        //         onlyReturnItems: true,
        //     });

        //     // Filter the nodes based on what is in the search text 
        //     const filteredItems = currentItems.filter(qpItem => {
        //         return stripDiacritics(qpItem.label).includes(cleanSearch)
        //             || stripDiacritics(qpItem.description || "").includes(cleanSearch)
        //     });

        //     // Retrieve all parents of the nodes and store their uris as a set
        //     const uriSet: Record<UriFsPathFormatted, OutlineNode> = {};
        //     const nodeQueue: OutlineNode[] = filteredItems.map(({ node }) => node);
        //     while (nodeQueue.length > 0) {
        //         const current = nodeQueue.shift();
        //         if (!current) continue;

        //         // If we have not seen current node yet, add it to the uri set, 
        //         //      then add parent to queue
        //         const uriForCompare = formatFsPathForCompare(current.getUri());
        //         if (uriForCompare in uriSet) {
        //             continue;
        //         }
        //         uriSet[uriForCompare] = current;

        //         // No parents of root, do not go any further
        //         if (current.data.ids.type === 'root') continue;

        //         // Search for parent in all views.  Exit early if it wasn't found or
        //         //      if it's a notebook document (shouldn't be remotely possible, but
        //         //      check anyways)
        //         const parent = await vagueNodeSearch(current.data.ids.parentUri);
        //         if (parent.node === null || parent.source === null || parent.source === 'notebook') continue;
        //         nodeQueue.push(parent.node);
        //     }

        //     // Refresh inputs, adding a new predicate that each node in the QP must be in 
        //     //      the uriSet Record calculated above
        //     const items = refreshInputs({
        //         newPredicates: [ (node: OutlineNode) => {
        //             const uriForCompare = formatFsPathForCompare(node.data.ids.uri);
        //             return uriForCompare in uriSet;
        //         }],
        //         onlyReturnItems: true,
        //     });
        //     qp.items = items;
        // }));
    });
}