import * as vscode from 'vscode';
import { Packageable } from '../packageable';

interface Node {
    once: boolean
}

export class WorldNotes implements vscode.TreeDataProvider<Node>, Packageable {

    protected view: vscode.TreeView<Node>;
    constructor (
        protected context: vscode.ExtensionContext
    ) {
        this.view = vscode.window.createTreeView(`wt.worldNotes.tree`, {
            treeDataProvider: this,
            canSelectMany: true,
            showCollapseAll: true,
        });
    }

    getPackageItems(): { [index: string]: any; } {
        throw new Error('Method not implemented.');
    }
    onDidChangeTreeData?: vscode.Event<void | Node | Node[] | null | undefined> | undefined;
    getTreeItem({once}: Node): vscode.TreeItem | Thenable<vscode.TreeItem> {
        if (!once) return {
            id: Math.random() + '',
            contextValue: 'folder',
            label: "World Notes",
            description: "wdawddddddddddddddddd",
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            tooltip: "awdawd",
        }
        else return {
            id: Math.random() + '',
            contextValue: 'folder',
            label: "World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes ",
            description: "wdawddddddddddddddddd",
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            tooltip: "World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes World Notes ",
        }
    }
    once = false;
    getChildren(element?: Node | undefined): vscode.ProviderResult<Node[]> {
        if (!element) return [{once:false}];
        
        if (!this.once) {
            this.once = true;
            return [{once:true}];
        }
        return [];
    }
    getParent?(element: Node): vscode.ProviderResult<Node> {
        throw new Error('Method not implemented.');
    }
}