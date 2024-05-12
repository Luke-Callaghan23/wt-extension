import * as vscode from 'vscode';
import { OutlineView } from './outline/outlineView';
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from './outline/nodes_impl/outlineNode';
import { queryWordHippo } from './intellisense/querySynonym';


export interface IFragmentPick {
    label: string;
    description?: string;
    node: OutlineNode;
    childOfTarget: boolean,
}

export interface IButton extends vscode.QuickInputButton {
    iconPath: vscode.ThemeIcon,
    tooltip: string,
    id: 'filterButton' | 'clearFilters'
}

function getOptions (outlineView: OutlineView, filterGeneric: boolean, targetNode?: vscode.Uri): {
    options: IFragmentPick[],
    currentNode: OutlineNode | undefined,
    currentPick: IFragmentPick | undefined
} {
    const options: IFragmentPick[] = [];

    const currentDoc: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri;
    let currentNode: OutlineNode | undefined;
    let currentPick: IFragmentPick | undefined;

    
    const giveMeSomeSpace = (indentLevel: number): string => {
        return '│' + ' '.repeat(Math.floor(indentLevel));
    }

    
    const processSnip = (snip: SnipNode, node: OutlineNode, indentLevel: number, path: string, isChildOfTarget: boolean) => {
        const space = giveMeSomeSpace(indentLevel);
        options.push({
            label: `${space}└─$(folder) Snip: ${snip.ids.display}`,
            description: `(${path})`,
            node: node,
            childOfTarget: isChildOfTarget
        })
        for (const content of snip.contents) {
            if (content.data.ids.type === 'fragment') {
                options.push({
                    label: `${space}${space}└─$(edit) ${content.data.ids.display}`,
                    description: `(${path}/${snip.ids.display})`,
                    node: content,
                    childOfTarget: isChildOfTarget
                });
                
                if (!currentNode && currentDoc && content.data.ids.uri.fsPath === currentDoc.fsPath) {
                    currentNode = content;
                    currentPick = options[options.length - 1];
                }
                else if (!isChildOfTarget && filterGeneric && content.data.ids.display.startsWith("Imported Fragment (") || content.data.ids.display.startsWith("New Fragment (")) {
                    options.pop();
                }
            }
            else if (content.data.ids.type === 'snip') {
                processSnip(
                    content.data as SnipNode, 
                    content, 
                    indentLevel + TAB_SIZE, 
                    `${path}/${snip.ids.display}`, 
                    isChildOfTarget 
                    || targetNode?.fsPath === content.data.ids.uri.fsPath
                );
            }
        }
    }


    const processChapter = (chapter: ChapterNode, node: OutlineNode, indentLevel: number, path: string, isChildOfTarget: boolean) => {

        const space = giveMeSomeSpace(indentLevel);
        options.push({
            label: `${space}└─$(folder) Chapter: ${chapter.ids.display}`,
            description: `(${path})`,
            node: node,
            childOfTarget: isChildOfTarget
        })
        for (const fragment of chapter.textData) {
            options.push({
                label: `${space}${space}└─$(edit) ${fragment.data.ids.display}`,
                description: `(${path}/${chapter.ids.display})`,
                node: fragment,
                childOfTarget: isChildOfTarget
            });
            if (!currentNode && currentDoc && fragment.data.ids.uri.fsPath === currentDoc.fsPath) {
                currentNode = fragment;
                currentPick = options[options.length - 1];
            }
            else if (!isChildOfTarget && filterGeneric && fragment.data.ids.display.startsWith("Imported Fragment (") || fragment.data.ids.display.startsWith("New Fragment (")) {
                options.pop();
            }
        }
        options.push({
            label: `${space}└─$(folder) ${chapter.snips.data.ids.display}`,
            description: `(${path}/${chapter.ids.display})`,
            node: chapter.snips,
            childOfTarget: isChildOfTarget
        });
        for (const snip of (chapter.snips.data as ContainerNode).contents) {
            processSnip(
                snip.data as SnipNode, 
                snip, 
                indentLevel + TAB_SIZE, 
                `${path}/${chapter.ids.display}/Snips`, 
                isChildOfTarget 
                || targetNode?.fsPath === chapter.snips.data.ids.uri.fsPath 
                || targetNode?.fsPath === snip.data.ids.uri.fsPath
            );
        }
    }

    const root = outlineView.rootNodes[0].data as RootNode;
    options.push({
        label: "$(folder) Chapters:",
        description: ``,
        node: root.chapters,
        childOfTarget: targetNode?.fsPath === root.chapters.data.ids.uri.fsPath
    })
    const chapters = (root.chapters.data as ContainerNode).contents;
    for (const chapter of chapters) {
        processChapter(
            chapter.data as ChapterNode, 
            chapter, 
            TAB_SIZE, 
            'Chapters', 
            targetNode?.fsPath === root.chapters.data.ids.uri.fsPath
            || targetNode?.fsPath === chapter.data.ids.uri.fsPath
        );
    }
    
    options.push({
        label: "$(folder) Work Snips:",
        description: ``,
        node: root.snips,
        childOfTarget: targetNode?.fsPath === root.snips.data.ids.uri.fsPath
    })
    const snips = (root.snips.data as ContainerNode).contents;
    for (const snip of snips) {
        processSnip(
            snip.data as SnipNode, 
            snip, 
            TAB_SIZE, 
            'Work Snips', 
            targetNode?.fsPath === root.snips.data.ids.uri.fsPath
            || targetNode?.fsPath === snip.data.ids.uri.fsPath
        );
    }

    return {
        options: targetNode ? options.filter(op => op.childOfTarget) : options,
        currentNode,
        currentPick
    };
}

const TAB_SIZE: number = 4;
export async function searchFiles () {
    
    const qp = vscode.window.createQuickPick<IFragmentPick>();
    qp.canSelectMany = false;
    qp.ignoreFocusOut = true;
    qp.matchOnDescription = true;
    qp.busy = true;

    qp.show();

    
    const outlineView: OutlineView = await vscode.commands.executeCommand("wt.outline.getOutline");
    const { options, currentNode, currentPick } = getOptions(outlineView, true);
    
    qp.busy = false;
    qp.items = options;
    if (currentPick) {
        qp.activeItems = [ currentPick ];
        qp.value = `${currentPick.description?.slice(1, currentPick.description.length-1)}`
    } 

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
    qp.onDidTriggerButton((button: IButton) => {
        if (button.id === 'filterButton') {
            isFiltering = !isFiltering;
            qp.busy = true;
            const { options, currentNode, currentPick } = getOptions(outlineView, isFiltering);
            qp.items = options;
            if (currentPick) {
                qp.activeItems = [ currentPick ];
                qp.value = `${currentPick.description?.slice(1, currentPick.description.length-1)}`
            }
            qp.busy = false;
        }
        else if (button.id === 'clearFilters') {
            isFiltering = false;
            qp.busy = true;
            const { options, currentNode, currentPick } = getOptions(outlineView, isFiltering);
            qp.items = options;
            qp.value = ``
            qp.busy = false;
        }
    });

    qp.onDidAccept(() => {
        const [ selected ] = qp.selectedItems;
        outlineView.view.reveal(selected.node);
        if (selected.node.data.ids.type === 'fragment') {
            vscode.window.showTextDocument(selected.node.data.ids.uri);
            qp.dispose();
        }
        else {
            qp.busy = true;
            qp.value = `${selected.description?.slice(1, selected.description.length - 1)}/${selected.node.data.ids.display}`;
            qp.busy = false;
        }
    });
}