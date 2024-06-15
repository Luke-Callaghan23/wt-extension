import * as vscode from 'vscode';
import * as extension from './../extension';
import { WordWatcher } from "./wordWatcher";
import { OutlineView } from '../outline/outlineView';
import { WordCount } from '../wordCounts/wordCount';
import { getFilesQPOptions, IFragmentPick } from '../searchFiles';
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from '../outline/nodes_impl/outlineNode';
import { lastCommit, setLastCommit } from '../gitTransactions';

export type InstanceCount = { [index: string]: number };

export interface IButton extends vscode.QuickInputButton {
    iconPath: vscode.ThemeIcon,
    tooltip: string,
    id: 'filterSnipsButton' | 'clearFilters'
}

export async function producePaths (isFilteringSnips: boolean, selected: readonly IFragmentPick[]): Promise<string[]> {
    const collectPathsRoot = (rootNode: OutlineNode): string[] => {
        const root = rootNode.data as RootNode;
        return [
            ...collectPathsContainer(root.chapters),
            ...collectPathsContainer(root.snips)
        ];
    };
    const collectPathsContainer = (containerNode: OutlineNode): string[] => {
        const container = containerNode.data as ContainerNode;
        return container.contents.map(content => {
            if (content.data.ids.type === 'snip') {
                return collectPathsSnip(content);
            }
            else if (content.data.ids.type === 'chapter') {
                return collectPathsChapter(content);
            }
            else return [];
        }).flat();
    };
    const collectPathsChapter = (chapterNode: OutlineNode): string[] => {
        const chapter = chapterNode.data as ChapterNode;
        return [
            ...chapter.textData.map(frag => frag.data.ids.uri.fsPath),
            ...collectPathsContainer(chapter.snips)
        ];
    };
    const collectPathsSnip = (snipNode: OutlineNode): string[] => {
        if (isFilteringSnips) return [];
        const snip = snipNode.data as SnipNode;
        return snip.contents.map(content => {
            if (content.data.ids.type === 'snip') {
                return collectPathsSnip(content);
            }
            else if (content.data.ids.type === 'fragment') {
                return content.data.ids.uri.fsPath;
            }
            else return [];
        }).flat();
    };
    
    const pathsSet = new Set<string>();
    for (const select of selected) {
        switch (select.node.data.ids.type) {
            case 'root': collectPathsRoot(select.node).forEach(path => pathsSet.add(path)); break;
            case 'container': collectPathsContainer(select.node).forEach(path => pathsSet.add(path)); break;
            case 'chapter': collectPathsChapter(select.node).forEach(path => pathsSet.add(path)); break;
            case 'snip': collectPathsSnip(select.node).forEach(path => pathsSet.add(path)); break;
            case 'fragment': pathsSet.add(select.node.data.ids.uri.fsPath); break;
        }
    }
    return [...pathsSet];
}

export async function readAndCollectCommonWords (paths: string[]): Promise<InstanceCount> {
    const allWords = (await Promise.all(paths.map(fragment => {
        const fragmentUri = vscode.Uri.file(fragment)
        return vscode.workspace.fs.readFile(fragmentUri).then(buffer => {
            const text = extension.decoder.decode(buffer);
            const words = text.split(WordCount.nonAlphanumeric)
                .filter(str => str.length !== 0)
                .filter(str => (/\s*/.test(str)))
                .map(str => str.toLocaleLowerCase().trim());
            
            return words;
        })
    }))).flat();

    const fragmentInstances: InstanceCount = {};
    allWords.forEach(word => {
        if (/^(\d+|and|the|of|to)$/.test(word)) return;
        if (word.length === 1) return;


        if (word in fragmentInstances) {
            fragmentInstances[word]++;
        }
        else {
            fragmentInstances[word] = 1;
        }
    });
    return fragmentInstances;
}

const uncontractWord = (word: string) => {
    const map: { [index: string]: string } = {
        "aren": "aren't",
        "couldn": "couldn't",
        "didn": "didn't",
        "doesn": "doesn't",
        "don": "don't",
        "hadn": "hadn't",
        "hasn": "hasn't",
        "haven": "haven't",
        "weren": "weren't",
        "where": "where's",
        "isn": "isn't",
        "mightn": "mightn't",
        "mustn": "mustn't",
        "won": "won't",
        "shan": "shan't",
        "wouldn": "wouldn't",
        "shouldn": "shouldn't",
    };
    return map[word] || word;
}

export async function gatherPaths (this: WordWatcher): Promise<string[] | null> {
    return new Promise(async (accept, reject) => {
        const qp = vscode.window.createQuickPick<IFragmentPick>();
        qp.canSelectMany = true;
        qp.ignoreFocusOut = true;
        qp.matchOnDescription = true;
        qp.busy = true;
        qp.show();
        
        const outlineView: OutlineView = await vscode.commands.executeCommand("wt.outline.getOutline");
        const { options, currentNode, currentPick } = getFilesQPOptions(outlineView, false);
        
        qp.busy = false;
        qp.items = [ 
            {
                label: "everything",
                node: outlineView.rootNodes[0], 
                description: "beep",
                kind: vscode.QuickPickItemKind.Separator
            },
            {
                label: "Entire Project",
                node: outlineView.rootNodes[0],
                description: "Get common words from the entire project",
                alwaysShow: true,
            }, 
            {
                label: "filter by outline",
                node: outlineView.rootNodes[0], 
                description: "beep",
                kind: vscode.QuickPickItemKind.Separator
            },
            ...options 
        ];
        if (currentPick) {
            qp.activeItems = [ currentPick ];
            qp.value = `${currentPick.description?.slice(1, currentPick.description.length-1)}`
        } 

        const snipFilterButton: IButton = {
            iconPath: new vscode.ThemeIcon("filter"),
            tooltip: "Filter All Snips (only include main fragments from chapters)",
            id: 'filterSnipsButton',
        };

        const snipFilterActiveButton: IButton = {
            iconPath: new vscode.ThemeIcon("", new vscode.ThemeColor("charts.yellow")),
            tooltip: "Include Snips",
            id: 'filterSnipsButton',
        }

        qp.buttons = [ snipFilterButton ];
    
        let isFilteringSnips = false;
        //@ts-ignore
        qp.onDidTriggerButton((button: IButton) => {
            if (button.id === 'filterSnipsButton') {
                isFilteringSnips = !isFilteringSnips;
                qp.busy = true;
                const snipsFilter = (outlineNode: OutlineNode) => {
                    // Filter any snips
                    if (outlineNode.data.ids.type === 'snip') return false;
                    // Filter containers only when they are snip containers
                    if (outlineNode.data.ids.type === 'container') {
                        // If the parent of the container is a chapter, or the container's uri matches the work snips container uri, then 
                        //      filter this snip container
                        return !(
                            outlineNode.data.ids.parentTypeId === 'chapter' 
                            || outlineNode.data.ids.uri.fsPath === (outlineView.rootNodes[0].data as RootNode).snips.data.ids.uri.fsPath
                        );
                    }
                    return true;
                };

                const { options, currentNode, currentPick } = getFilesQPOptions(outlineView, false, isFilteringSnips ? [ snipsFilter ] : []);
                qp.items = options;
                if (currentPick) {
                    qp.activeItems = [ currentPick ];
                    qp.value = `${currentPick.description?.slice(1, currentPick.description.length-1)}`
                }
                qp.buttons = isFilteringSnips ? [
                    snipFilterActiveButton
                ] : [
                    snipFilterButton
                ];
                qp.busy = false;
            }
        });

        qp.onDidAccept(() => {
            producePaths(isFilteringSnips, qp.selectedItems).then(paths => {
                accept(paths);
            });
        });
    });
}

const THRESHOLD = 20;
async function getChosenCommonWords (ww: WordWatcher): Promise<string[] | null> {
    return new Promise(async (accept, reject) => {
        const paths = await ww.gatherCommonWords();
        if (!paths) return null;
    
        const qp = vscode.window.createQuickPick<{ word: string, label: string, description: string }>();
        qp.canSelectMany = true;
        qp.ignoreFocusOut = true;
        qp.matchOnDescription = true;
        qp.title = "Reading Common Words from disk... this may take a moment..."
        qp.busy = true;
        qp.show();
    
        const words = await readAndCollectCommonWords(paths);
        const filtered: InstanceCount = {};
        Object.entries(words).forEach(([ word, count ]) => {
            if (count > THRESHOLD) {
                filtered[word] = count;
            }
        });
        const orderedCommonWords: [ string, number ][] = Object.entries(filtered).sort((a, b) => b[1] - a[1]);
        const uncontracted: [ string, number ][] = orderedCommonWords.map(([ word, count ]) => [ uncontractWord(word), count ]);
        
        qp.items = uncontracted.map(([ word, count ]) => {
            return {
                label: `${word} : (${count})`,
                description: word,
                word: word,
            };
        });
        qp.title = "Select words you would like to watch out for:"
        qp.busy = false;
    
    
        qp.onDidAccept(() => {
            accept(qp.selectedItems.map(({ word }) => word));
        });
    })
}


export async function commonWordsPrompt (this: WordWatcher) {
    const chosenWords = await getChosenCommonWords(this);
    if (!chosenWords) return;
    
    type Response = "Single Item (recommended)" | "Multiple";
    const responses: Response[] = [ "Single Item (recommended)", "Multiple" ]
    const r = await vscode.window.showQuickPick(responses, {
        canPickMany: false,
        ignoreFocusOut: false,
        matchOnDescription: true,
        matchOnDetail: true,
        title: "Create multiple Word Watcher items or a single one with multiple options?"
    });
    if (!r) return;

    const response = r as Response;
    if (response === 'Single Item (recommended)') {
        const reg = chosenWords.join("|");
        setLastCommit();
        this.updateWords('add', reg, 'wt.wordWatcher.watchedWords', -1, true);
    }
    else if (response === 'Multiple') {
        chosenWords.forEach(cw => {
            setLastCommit();
            this.updateWords('add', cw, 'wt.wordWatcher.watchedWords', -1, true);
        });
    }
    return this.refresh();
}