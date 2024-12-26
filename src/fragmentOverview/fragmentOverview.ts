import * as vscode from 'vscode';
import * as extension from '../extension';
import { Timed } from '../timedView';
import { Workspace } from '../workspace/workspaceClass';
import { compareFsPath, getSurroundingTextInRange } from '../miscTools/help';

export class FragmentOverviewNode {
    beginningOfLine: string;
    fullLine: string;
    uri: vscode.Uri;
    lineZeroIndex: number;
    constructor(
        beginningOfLine: string, 
        fullLine: string,
        uri: vscode.Uri,
        lineZeroIndex: number,
    ) {
        this.beginningOfLine = beginningOfLine;
        this.fullLine = fullLine;
        this.uri = uri;
        this.lineZeroIndex = lineZeroIndex;
    }
}

export class FragmentOverviewView implements vscode.TreeDataProvider<FragmentOverviewNode>, Timed {
    enabled: boolean;
    bulletPoints: FragmentOverviewNode[];
    view: vscode.TreeView<FragmentOverviewNode>;
    activeDocumentUri: vscode.Uri | null;
    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
    ) {
        this.enabled = true;
        this.bulletPoints = [];
        this.view = vscode.window.createTreeView('wt.overview', {
            treeDataProvider: this,
            canSelectMany: true,
            showCollapseAll: true,
        });
        this.activeDocumentUri = null;
        this.registerCommands();
    }

    private registerCommands () {
        vscode.commands.registerCommand('wt.overview.goToLine', (line: FragmentOverviewNode) => {
            if (!vscode.window.activeTextEditor) {
                return;
            }

            const startLine = new vscode.Position(line.lineZeroIndex, 0);
            const endLine = new vscode.Position(line.lineZeroIndex + 1, 0)
            const selection = new vscode.Selection(startLine, endLine);
            return vscode.window.showTextDocument(line.uri, {
                selection: selection,
                preserveFocus: false,
            });
        });

        vscode.window.onDidChangeTextEditorSelection(async (event) => {
            if (!this.activeDocumentUri || !compareFsPath(event.textEditor.document.uri, this.activeDocumentUri)) {
                return;
            }
            const lines: FragmentOverviewNode[] = [];
            for (const selection of event.selections) {
                for (let selectionLine = selection.start.line; selectionLine < selection.end.line + 1; selectionLine++) {
                    const bullet = this.bulletPoints.find(bullet => bullet.lineZeroIndex === selectionLine);
                    if (bullet) {
                        lines.push(bullet);
                    }
                }
            }
            if (lines.length > 0) {
                return this.view.reveal(lines[lines.length - 1], {
                    expand: true,
                    focus: false,
                    select: true
                });
            }
        });

        vscode.window.onDidChangeActiveTextEditor(event => {
            if (!event) {
                this.activeDocumentUri = null;
                this.bulletPoints = [];
                this.view.message = 'Open a .wt or .wtNote document to get a Text Overview';
                this.refresh();
            }
        });
    }

    async update (editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        this.view.message = undefined;
        const text = editor.document.getText();
        const lines = text.split('\n');
        this.bulletPoints = [];
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex].trim();
            if (line.length === 0 || /^\s*$/.test(line)) continue;

            const surrounding = getSurroundingTextInRange(editor.document, text.length, new vscode.Location(editor.document.uri, new vscode.Position(lineIndex, 0)), [0, 120], true);
            this.bulletPoints.push({
                beginningOfLine: surrounding.surroundingText.trim(),
                fullLine: line,
                uri: editor.document.uri,
                lineZeroIndex: lineIndex
            });
        }
        this.activeDocumentUri = editor.document.uri;
        this.refresh();
    }

    private _onDidChangeTreeData: vscode.EventEmitter<FragmentOverviewNode[] | undefined> = new vscode.EventEmitter<FragmentOverviewNode[] | undefined>();
    readonly onDidChangeTreeData: vscode.Event<FragmentOverviewNode[] | undefined> = this._onDidChangeTreeData.event;
    async refresh(): Promise<void> {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: FragmentOverviewNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return {
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            label: element.beginningOfLine,
            iconPath: new vscode.ThemeIcon("debug-breakpoint"),
            tooltip: element.fullLine,
            command: {
                command: 'wt.overview.goToLine',
                title: "Go To Line",
                arguments: [ element ]
            }
        }
    }

    getChildren(element?: FragmentOverviewNode | undefined): vscode.ProviderResult<FragmentOverviewNode[]> {
        if (!element) return this.bulletPoints;
        return [];
    }


    getParent(element: FragmentOverviewNode): vscode.ProviderResult<FragmentOverviewNode> {
        return null;
    }

}