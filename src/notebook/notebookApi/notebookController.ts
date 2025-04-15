import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import { NotebookPanel } from '../notebookPanel';
import { _, compareFsPath } from '../../miscTools/help';
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

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.convertToHeader", this.transformToHeader.bind(this)));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.editHeader", this.editHeaderText.bind(this)));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.editCell", this.transformToWTNote.bind(this)));
    }

    // Called on a wtnote Code cell -- if that cell has content on exactly one line,
    //      then that cell will be swapped out for a 'header' cell, and the cells 
    //      beneath it will be treated as its children
    private async transformToHeader (cell: vscode.NotebookCell) {
        
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.start(Date.now());
        
        // Ensure content on only one line, and exit early if not
        const text = cell.document.getText();
        const fullLines = text.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
        if (fullLines.length > 1) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stderr(`[ERROR] Header cells must have text on exactly one line.  Please remove text from ${fullLines.length - 1} line(s) of this cell to convert it into a header.`)
                ], {})
            ]);
            execution.end(true, Date.now());
            return;
        }

        // If there is content on just one line, then add output with metadata indicating that
        //      this cell needs to be converted to a header, and reopen the notebook
        execution.replaceOutput([
            new vscode.NotebookCellOutput([], _<NotebookCellOutputMetadata>({
                convert: 'header'
            }))
        ]);
        execution.end(true, Date.now());
        return this.reopenNotebook(cell.notebook);
    }

    // Called on markdown cell with metadata.kind === 'header'
    // Used to change the text of the header cell in the notebook and the NotebookPanel
    private async editHeaderText (cell: vscode.NotebookCell) {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.start(Date.now()); // Keep track of elapsed time to execute cell.

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
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stderr("[WARN] Cannot call editHeader on non-header notebook cell")
                ])
            ]);
            execution.end(true, Date.now());
            return;
        }

        // If this is a valid cell to call editHeader on, then query the user for the updated header text value
        const newName = await vscode.window.showInputBox({
            placeHolder: originalText,
            prompt: `What would you like to rename header '${originalText}'?`,
            ignoreFocusOut: false,
            value: originalText,
            valueSelection: [0, originalText.length]
        });
        if (!newName) return;

        // And store that updated value in output metadata for the NotebookSerilizer to pick up
        execution.replaceOutput([
            new vscode.NotebookCellOutput([], _<NotebookCellOutputMetadata>({
                updateValue: newName
            }))
        ]);
        execution.end(true, Date.now());
        return this.reopenNotebook(cell.notebook);
    }

    // Called on a markdown cell with metadata.kind === 'input'
    // Used to convert the markdown cell back into its wtnote Code cell equivalent so that the user
    //      can then update contents
    private async transformToWTNote (cell: vscode.NotebookCell) {
        const cellMetadata = cell.metadata as NotebookCellMetadata | undefined;
        if (cellMetadata) {
            const execution = this.controller.createNotebookCellExecution(cell);
            execution.start(Date.now());
            if (cellMetadata.kind === 'header' || cellMetadata.kind === 'header-title') {
                // Should never be called
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr("[WARN] Cannot edit headers.  Either delete this header or select 'Edit header'")
                    ])
                ]);
                execution.end(true, Date.now());
                return;
            }
            
            // Add output with flag to convert this to an input box and reopen the document
            execution.appendOutput([
                new vscode.NotebookCellOutput([], _<NotebookCellOutputMetadata>({
                    convert: 'input'
                }))
            ]);
            execution.end(true, Date.now());
            return this.reopenNotebook(cell.notebook);
        }
        else {
            throw 'todo'
        }
    }

    // When an execute operation is called on a wtnote Code cell, we want to swap that cell
    //      out for a markdown cell
    private async execute(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
        update: boolean = true
    ): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.start(Date.now());

        // Add an output to the cell with `convert` set to `markdown`
        // The NotebookSerializer will see this flag and will update the 
        //      cell accordingly on disk
        execution.replaceOutput([
            new vscode.NotebookCellOutput([], _<NotebookCellOutputMetadata>({
                convert: 'markdown'
            }))
        ]);
        execution.end(true, Date.now());

        // Then, reopen the notebook
        if (update) {
            return this.reopenNotebook(notebook);
        }
    }


    private executionHandler(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        controller: vscode.NotebookController
    ): void {
        for (let cell of cells) {
            // Since we may be updating more than one cell, we call execute with update=false,
            //      so that all the updates can be applied at once before we manually call
            //      `reopenNotebook` at the end of this method
            this.execute(cell, notebook, false);
        }
        this.reopenNotebook(notebook);
    }


    // Saves the notebook document, stores the view column, closes the document
    //      then reopens it
    // See: note at the top of `NotebookSerializer.ts` about how the notebook
    //      serilaizer and controller function
    // Once updates are stored in the metadata of the cells or the cells' outputs,
    //     those updates are saved to the wtnote file on the file system by 
    //     the NotebookSerializer (during notebook.save())
    // And those changes are then reflected in the notebook document when it is 
    //     deserialized again and opened by VSCode
    private async reopenNotebook (notebook: vscode.NotebookDocument) {
        await notebook.save();

        // Store the view column of this notebook so that it can be reopened
        //      in the same location that it was closed
        const viewColumn = vscode.window.activeNotebookEditor!.viewColumn!;

        // Search for the tab that this notebook occupies, and close it
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (!(tab.input instanceof vscode.TabInputNotebook)) continue;
                if (!compareFsPath(tab.input.uri, notebook.uri)) continue;

                await vscode.window.tabGroups.close(tab);
                break;
            }
        }
        
        // Reopen the document
        await vscode.window.showNotebookDocument(notebook, {
            viewColumn: viewColumn,
        });

        // Assign tab labels again
        return TabLabels.assignNamesForOpenTabs();
    }
}