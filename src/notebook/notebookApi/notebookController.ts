import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import { NotebookPanel } from '../notebookPanel';
import { compareFsPath } from '../../miscTools/help';
import { TabLabels } from '../../tabLabels/tabLabels';
import { NotebookCellMetadata, NotebookCellOutputMetadata, NotebookMetadata } from './notebookSerializer';

export class WTNotebookController {
    readonly controllerId = 'wt.notebook.controller';
    readonly notebookType = 'wt.notebook';
    readonly label = 'Writing Tool Notebook Controller';
    readonly supportedLanguages = ['wtnote'];

    private readonly controller: vscode.NotebookController;
    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private notebook: NotebookPanel,
    ) {
        this.controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this.controller.supportedLanguages = this.supportedLanguages;
        this.controller.executeHandler = this.executionHandler.bind(this);

        vscode.window.onDidChangeNotebookEditorSelection(selection => {
            const selectedCell = selection.notebookEditor.notebook.getCells(selection.selections[0])[0];
            const cellMetadata: NotebookCellMetadata | undefined = selectedCell.metadata as any;
            vscode.commands.executeCommand("setContext", "cellKindContextValue", cellMetadata?.kind || 'unknown');
        });

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.convertToHeader", (cell: vscode.NotebookCell) => {

            // 
            const text = cell.document.getText();
            const fullLines = text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)

            const execution = this.controller.createNotebookCellExecution(cell);
            execution.start(Date.now());
            
            
            if (fullLines.length > 1) {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(`[ERROR] Header cells must have text on exactly one line.  Please remove text from ${fullLines.length - 1} line(s) of this cell to convert it into a header.`)
                    ], {})
                ]);
            }
            else {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([], (<NotebookCellOutputMetadata>{
                        convert: 'header'
                    }))
                ]);
            }
            execution.end(true, Date.now());
            this.reopenNotebook(cell.notebook);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.editHeader", async (cell: vscode.NotebookCell) => {
            
            let originalText: string;
            try {
                // To call `editHeader` on a cell, that cell must have been created by `notebookSerializer.deserializeNotebook`
                // In that case, there must be a `metadata` object of type `NotebookCellMetadata` with kind === 'header'
                // If any of that is not the case, then stop now
                const metadata = cell.metadata! as NotebookCellMetadata;
                if (metadata.kind !== 'header') {
                    throw 'Not a header';
                }
                originalText = metadata.originalText;
                if (!metadata.originalText) {
                    throw `Empty header`
                }
            }
            catch (err: any) {
                const execution = this.controller.createNotebookCellExecution(cell);
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr("[WARN] Cannot call editHeader on non-header notebook cell")
                    ])
                ]);
                execution.end(true, Date.now());
                return;
            }

            const newName = await vscode.window.showInputBox({
                placeHolder: originalText,
                prompt: `What would you like to rename header '${originalText}'?`,
                ignoreFocusOut: false,
                value: originalText,
                valueSelection: [0, originalText.length]
            });
            if (!newName) return;


            const execution = this.controller.createNotebookCellExecution(cell);
            execution.replaceOutput([
                new vscode.NotebookCellOutput([], (<NotebookCellOutputMetadata> {
                    updateValue: newName
                }))
            ]);
            execution.end(true, Date.now());
            this.reopenNotebook(cell.notebook);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.editCell", (cell: vscode.NotebookCell) => {
            const cellMetadata = cell.metadata as NotebookCellMetadata | undefined;
            if (cellMetadata) {
                if (cellMetadata.kind === 'header' || cellMetadata.kind === 'header-title') {
                    const execution = this.controller.createNotebookCellExecution(cell);
                    execution.start(Date.now());
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.stderr("[WARN] Cannot edit headers.  Either delete this header or select 'Edit header'")
                        ])
                    ]);
                    execution.end(true, Date.now());
                }
                else if (cellMetadata.kind === 'input') {
                    const newMetadata = {
                        ...cellMetadata
                    }
                    newMetadata.markdown = !newMetadata.markdown;
                    const notebookMetadata = cell.notebook.metadata as NotebookMetadata;
                    notebookMetadata.modifications[cell.index] = newMetadata;
                    return this.execute(cell, cell.notebook);
                }
            }
            else {
                throw 'todo'
            }
        }));
    }

    private async reopenNotebook (notebook: vscode.NotebookDocument) {
        await notebook.save();

        const viewColumn = vscode.window.activeNotebookEditor!.viewColumn!;
        
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (!(tab.input instanceof vscode.TabInputNotebook)) continue;
                if (!compareFsPath(tab.input.uri, notebook.uri)) continue;

                await vscode.window.tabGroups.close(tab);
                break;
            }
        }
        
        await vscode.window.showNotebookDocument(notebook, {
            viewColumn: viewColumn,
        });
        return TabLabels.assignNamesForOpenTabs();
    }

    private executionHandler(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        controller: vscode.NotebookController
    ): void {
        for (let cell of cells) {
            this.execute(cell, notebook);
        }
    }

    private async execute(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument
    ): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.start(Date.now()); // Keep track of elapsed time to execute cell.

        execution.replaceOutput([
            new vscode.NotebookCellOutput([], (<NotebookCellOutputMetadata>{
                convert: 'markdown'
            }))
        ]);
        execution.end(true, Date.now());
        await this.reopenNotebook(notebook);
    }
}