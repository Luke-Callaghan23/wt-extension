import * as vscode from 'vscode';
import { OutlineView } from "../outlineView";
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from '../nodes_impl/outlineNode';
import * as extension from '../../extension';
import { CopiedSelection, genericPaste } from './copyPaste';
import { DiskContextType } from '../../workspace/workspace';
import { ConfigFileInfo, readDotConfig, writeDotConfig, setFsPathKey } from '../../miscTools/help';
import { searchFiles, selectFile } from '../../miscTools/searchFiles';
import { copyNode, copyPath, copyRelativePath, deleteNode, duplicateNode, moveNode, pasteNode, renameNode } from './contextMenuCommandPalletteImpls';


// Register all the commands needed for the outline view to work
export function registerCommands (this: OutlineView) {
    vscode.commands.registerCommand('wt.outline.openFile', (resource) => {
        vscode.window.showTextDocument(resource, { preserveFocus: true });
    });
    // Reload command has ambiguous changes and should include a full reload from disk
    vscode.commands.registerCommand('wt.outline.refresh', (resource: OutlineNode | DiskContextType['wt.outline.collapseState'] | undefined | null) => {

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

        
        this.refresh(true, []);
        return;
    });

    vscode.commands.registerCommand('wt.outline.renameFile', () => {
        if (this.view.selection.length > 1) return;
        this.renameResource();
    });

    vscode.commands.registerCommand("wt.outline.newChapter", (resource) => {
        this.newChapter(resource);
    });
    vscode.commands.registerCommand("wt.outline.newSnip", (resource) => {
        if (!resource && this.view.selection.length > 0) {
            // If the resource of the command is undefined, but there are selected items in the view
            //      then use the first selected item as the resource
            resource = this.view.selection[0];
        }
        this.newSnip(resource);
    });
    vscode.commands.registerCommand("wt.outline.newFragment", (resource) => {
        if (!resource && this.view.selection.length > 0) {
            // If the resource of the command is undefined, but there are selected items in the view
            //      then use the first selected item as the resource
            resource = this.view.selection[0];
        }
        this.newFragment(resource);
    });

    vscode.commands.registerCommand("wt.outline.moveUp", async (resource: OutlineNode) => {
        const parent = await this.getTreeElementByUri(resource.data.ids.parentUri);
        if (!parent) return;

        let collection: OutlineNode[];
        switch (parent.data.ids.type) {
            case 'chapter': {
                collection = (parent.data as ChapterNode).textData;
            } break;
            case 'container': case 'snip': {
                collection = (parent.data as ContainerNode | SnipNode).contents;
            } break;
            case 'root': 
            case 'fragment': 
                return null;
        }

        let movers: OutlineNode[];
        if (this.view.selection.length > 0) {
            let resourceInList = false;
            const filteredSelection = this.view.selection.filter(sel => {
                if (sel.data.ids.uri.fsPath === resource.data.ids.uri.fsPath) {
                    resourceInList = true;
                }
                return sel.data.ids.parentUri.fsPath === resource.data.ids.parentUri.fsPath;
            });
            if (!resourceInList) {
                filteredSelection.push(resource);
            }
            filteredSelection.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
            movers = filteredSelection;
        }
        else {
            movers = [ resource ];
        }

        let target: OutlineNode;
        if (movers[0].data.ids.ordering !== 0) {
            const above = collection.find(node => node.data.ids.ordering === movers[0].data.ids.ordering - 1);
            if (!above) return;
            target = above;
        }
        else return;

        
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.outline', new vscode.DataTransferItem(movers))
        return this.handleDrop(target, dataTransfer, {} as vscode.CancellationToken);
    });


    vscode.commands.registerCommand("wt.outline.moveDown", async (resource: OutlineNode) => {
        const parent = await this.getTreeElementByUri(resource.data.ids.parentUri);
        if (!parent) return;

        let collection: OutlineNode[];
        switch (parent.data.ids.type) {
            case 'chapter': {
                collection = (parent.data as ChapterNode).textData;
            } break;
            case 'container': case 'snip': {
                collection = (parent.data as ContainerNode | SnipNode).contents;
            } break;
            case 'root': 
            case 'fragment': 
                return null;
        }

        let movers: OutlineNode[];
        if (this.view.selection.length > 0) {
            let resourceInList = false;
            const filteredSelection = this.view.selection.filter(sel => {
                if (sel.data.ids.uri.fsPath === resource.data.ids.uri.fsPath) {
                    resourceInList = true;
                }
                return sel.data.ids.parentUri.fsPath === resource.data.ids.parentUri.fsPath;
            });
            if (!resourceInList) {
                filteredSelection.push(resource);
            }
            filteredSelection.sort((a, b) => b.data.ids.ordering - a.data.ids.ordering);
            movers = filteredSelection;
        }
        else {
            movers = [ resource ];
        }

        let target: OutlineNode;
        if (movers[movers.length - 1].data.ids.ordering !== collection.length - 1) {
            const below = collection.find(node => node.data.ids.ordering === movers[0].data.ids.ordering + 1);
            if (!below) return;
            target = below;
        }
        else return;

        
        const dataTransfer = new vscode.DataTransfer();
        dataTransfer.set('application/vnd.code.tree.outline', new vscode.DataTransferItem(movers))
        return this.handleDrop(target, dataTransfer, {} as vscode.CancellationToken);
    });
    
    vscode.commands.registerCommand("wt.outline.removeResource", (resource) => {
        let targets: OutlineNode[];
        if (resource) {
            targets = [resource];
        }
        else {
            targets = [...this.view.selection];
        }
    
        if (targets.length === 0) {
            return;
        }
        this.removeResource(targets);
    });

    vscode.commands.registerCommand("wt.outline.collectChapterUris", () => {
        const root: RootNode = this.rootNodes[0].data as RootNode;
        const chaptersContainer: ContainerNode = root.chapters.data as ContainerNode;
        const chapterData = chaptersContainer.contents.map(c => {
            const title = c.data.ids.display;
            const uri = c.getUri().fsPath.split(extension.rootPath.fsPath)[1];
            return { uri, title, ordering: c.data.ids.ordering };
        });

        chapterData.sort((a, b) => a.ordering - b.ordering);

        return chapterData.map(({ uri, title }) => [ uri, title ])
    });

    vscode.commands.registerCommand('wt.outline.help', () => {
        vscode.window.showInformationMessage(`Outline View`, {
            modal: true,
            detail: `The outline view gives a general outline of the structure of your project.  It shows all the chapters, chapter fragments, chapter snips, chapter snip fragments, work snips, and work snip fragments of your entire work.  For more information hit 'Ctrl+Shift+P' and type 'wt:help' into the search bar for more information.`
        }, 'Okay');
    });

    vscode.commands.registerCommand('wt.outline.getOutline', () => this);

    vscode.commands.registerCommand('wt.outline.copyItems', () => {
        // Ensure that there are selected items and then call the `copy` method
        const selected = this.view.selection;
        if (selected.length === 0) return;
        this.copy(selected);
    });

    vscode.commands.registerCommand('wt.outline.pasteItems', async (nameModifier: string | undefined) => {
        // If there is no selected detination for the paste in the outline
        //      view, then default to using the tree as the paste destination
        let selected = this.view.selection;
        if (selected.length === 0) selected = [ ...this.rootNodes ];

        const destinations: OutlineNode[] = [ ...selected ];
        return genericPaste(destinations);
    });

    vscode.commands.registerCommand('wt.outline.duplicateItems', async () => {
        await vscode.commands.executeCommand('wt.outline.copyItems');
        await vscode.commands.executeCommand('wt.outline.pasteItems', 'duplicated');
    });

    vscode.commands.registerCommand('wt.outline.copyPath', (resource: OutlineNode) => {
        vscode.env.clipboard.writeText(resource.data.ids.uri.fsPath);
    });

    vscode.commands.registerCommand('wt.outline.copyRelativePath', (resource: OutlineNode) => {
        vscode.env.clipboard.writeText(resource.data.ids.uri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/'));
    });

    vscode.commands.registerCommand('wt.outline.manualMove', async (resource: OutlineNode) => {
        const chose = await selectFile([ (node) => {
            return node.data.ids.type !== 'fragment'
        } ]);
        if (chose === null) return;
        if (chose.data.ids.type === 'root') return;
        
        const moveResult = await resource.generalMoveNode("move", chose, extension.ExtensionGlobals.recyclingBinView, extension.ExtensionGlobals.outlineView, 0, null, "Insert");
        if (moveResult.moveOffset === -1) return;
        const effectedContainers = moveResult.effectedContainers;
        const outline =  extension.ExtensionGlobals.outlineView;
        return outline.refresh(false, effectedContainers);
    });

    vscode.commands.registerCommand("wt.outline.commandPalette.copyNode", () => copyNode());
    vscode.commands.registerCommand("wt.outline.commandPalette.pasteNode", () => pasteNode());
    vscode.commands.registerCommand("wt.outline.commandPalette.duplicateNode", () => duplicateNode());
    vscode.commands.registerCommand("wt.outline.commandPalette.copyRelativePath", () => copyRelativePath());
    vscode.commands.registerCommand("wt.outline.commandPalette.copyPath", () => copyPath());
    vscode.commands.registerCommand("wt.outline.commandPalette.deleteNode", () => deleteNode());
    vscode.commands.registerCommand("wt.outline.commandPalette.moveNode", () => moveNode());
    vscode.commands.registerCommand("wt.outline.commandPalette.renameNode", () => renameNode());
}
