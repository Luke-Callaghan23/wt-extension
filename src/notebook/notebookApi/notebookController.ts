import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import { Notebook } from '../notebook';
import { compareFsPath } from '../../miscTools/help';
import { TabLabels } from '../../tabLabels/tabLabels';
import { DiskCellMetadata } from './notebookSerializer';

export class WTNotebookController {
    readonly controllerId = 'wt.notebook.controller';
    readonly notebookType = 'wt.notebook';
    readonly label = 'Writing Tool Notebook Controller';
    readonly supportedLanguages = ['wtnote'];

    private readonly controller: vscode.NotebookController;
    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private notebook: Notebook,
    ) {
        this.controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this.controller.supportedLanguages = this.supportedLanguages;
        this.controller.executeHandler = this.executionHandler.bind(this);
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

        /* Do some execution here; not implemented */

        execution.replaceOutput([
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text('Dummy output text!')
            ])
        ]);
        execution.end(true, Date.now());
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
}