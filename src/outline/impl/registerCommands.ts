import * as vscode from 'vscode';
import { OutlineView } from "../outlineView";
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from '../nodes_impl/outlineNode';
import { Extension } from   '../../extension';
import { CopiedSelection, genericPaste } from './copyPaste';
import { ConfigFileInfo, readDotConfig, writeDotConfig, setFsPathKey, vagueNodeSearch, showTextDocumentWithPreview } from '../../miscTools/help';
import { searchFiles, selectFile, selectFiles } from '../../miscTools/searchFiles';
import { NodeMoveKind } from '../nodes_impl/handleMovement/generalMoveNode';
import { DiskContextType } from '../../workspace/workspaceClass';


// Register all the commands needed for the outline view to work
export function registerCommands (this: OutlineView) {
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.openFile', async (resource) => {
        return showTextDocumentWithPreview(resource, { preserveFocus: true });
    }));
    // Reload command has ambiguous changes and should include a full reload from disk
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.refresh', this.refreshView.bind(this)));

    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.renameFile', () => {
        if (this.view.selection.length > 1) return;
        this.renameResource();
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.editDescription', (resource: OutlineNode) => {
        if (this.view.selection.length > 1) return;
        this.editNodeDescription(resource);
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.editMarkdownDescription', (resource: OutlineNode) => {
        if (this.view.selection.length > 1) return;
        this.editNodeMarkdownDescription(resource);
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.newChapter", (resource) => {
        this.newChapter(resource);
    }));
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.newSnip", (resource) => {
        if (!resource && this.view.selection.length > 0) {
            // If the resource of the command is undefined, but there are selected items in the view
            //      then use the first selected item as the resource
            resource = this.view.selection[0];
        }
        this.newSnip(resource);
    }));
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.newFragment", (resource) => {
        if (!resource && this.view.selection.length > 0) {
            // If the resource of the command is undefined, but there are selected items in the view
            //      then use the first selected item as the resource
            resource = this.view.selection[0];
        }
        this.newFragment(resource);
    }));
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.newFragmentMarkdown", (resource) => {
        if (!resource && this.view.selection.length > 0) {
            // If the resource of the command is undefined, but there are selected items in the view
            //      then use the first selected item as the resource
            resource = this.view.selection[0];
        }
        this.newFragment(resource, { markdown: true });
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.moveUp", async (resource: OutlineNode) => {
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
    }));


    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.moveDown", async (resource: OutlineNode) => {
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
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.removeResource", (resource) => {
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
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.collectChapterUris", this.collectChapterUris.bind(this)));

    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.help', () => {
        vscode.window.showInformationMessage(`Outline View`, {
            modal: true,
            detail: `The outline view gives a general outline of the structure of your project.  It shows all the chapters, chapter fragments, chapter snips, chapter snip fragments, work snips, and work snip fragments of your entire work.  For more information hit 'Ctrl+Shift+P' and type 'wt:help' into the search bar for more information.`
        }, 'Okay');
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.getOutline', () => this));

    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.copyItems', this.copyItems.bind(this)));
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.pasteItems', this.pasteItems.bind(this)));
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.duplicateItems', async () => {
        this.copyItems();
        this.pasteItems('duplicated');
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.copyPath', (resource: OutlineNode) => this.copyPath(resource)));
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.copyRelativePath', (resource: OutlineNode) => this.copyRelativePath(resource)));
    this.context.subscriptions.push(vscode.commands.registerCommand('wt.outline.manualMove', (resource: OutlineNode) => this.manualMove(resource)));

    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.copyNode", async () => {
        const result = await this.selectFiles();
        if (result === null) {
            return null;
        }
        const deletes = result;
        return this.removeResource(deletes);
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.pasteNode", async () => {
        const result = await this.selectFile();
        if (result === null) {
            return null;
        }
        return this.manualMove(result);
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.duplicateNode", async () => {
        const result = await this.selectFile();
        if (result === null) {
            return null;
        }
        const renamer = result;
        return this.renameResource(renamer);
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.copyRelativePath", async  () => {
        const result = await this.selectFile();
        if (result === null) {
            return null;
        }
        this.copyRelativePath(result);
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.copyPath", async () => {
        const result = await this.selectFile();
        if (result === null) {
            return null;
        }
        this.copyPath(result);
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.deleteNode", async () => {
        const result = await this.selectFiles();
        if (result === null) {
            return null;
        }
        const deletes = result;
        return this.removeResource(deletes);
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.moveNode", async () => {
        const result = await this.selectFile();
        if (result === null) {
            return null;
        }
        return this.manualMove(result);
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.moveCurrentNode", async () => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if  (!uri) {
            vscode.window.showWarningMessage("Could not find active document in Outline, Scratch Pad, or Recycling Bin");
            return;
        }

        const result = await vagueNodeSearch(uri);
        if (!result || result.source === 'notebook') {
            vscode.window.showWarningMessage("Could not find active document in Outline, Scratch Pad, or Recycling Bin");
            return;
        }
        
        // Source for manual move is dependant on where the vague node search originally found the node above
        let nodeMoveKind: NodeMoveKind;
        switch (result.source) {
            case 'scratch': nodeMoveKind = 'scratch'; break;
            case 'recycle': nodeMoveKind = 'recover'; break;
            default: nodeMoveKind = 'move'; break;
        }

        const node = result.node as OutlineNode;
        await this.manualMove(node, nodeMoveKind);

        // `manualMove` does not update non-Outline views, so if the source of the node was not outline
        //      then we have to manually update it
        if (result.source === 'scratch') {
            Extension.scratchPadView.refresh(true, []);
        }
        else if (result.source === 'recycle') {
            Extension.recyclingBinView.refresh(true, []);
        }
    }));
    
    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.renameNode", async () => {
        const result = await this.selectFile();
        if (result === null) {
            return null;
        }
        const renamer = result;
        return this.renameResource(renamer);
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.editActiveTabDescription", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const uri = editor.document.uri;
        const outlineNode = await this.getTreeElementByUri(uri);
        if (!outlineNode) return;

        return this.editNodeMarkdownDescription(outlineNode);
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.editDescription", async () => {
        const result = await this.selectFile();
        if (result === null) {
            return null;
        }
        return this.editNodeDescription(result);
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("wt.outline.commandPalette.editMarkdownDescription", async () => {
        const result = await this.selectFile();
        if (result === null) {
            return null;
        }
        return this.editNodeMarkdownDescription(result);
    }));
}
