import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import { NotebookPanel } from '../notebookPanel';
import { __, compareFsPath } from '../../miscTools/help';
import { TabLabels } from '../../tabLabels/tabLabels';
import { NotebookCellMetadata, NotebookCellOutputMetadata, NotebookMetadata, WTNotebookSerializer } from './notebookSerializer';
import { ExtensionGlobals,  } from '../../extension';

type ExecutionCommand = 'editHeader' | 'editTitle' | 'editCell' | 'convertToHeader';

export class WTNotebookController {
    readonly controllerId = 'wt.notebook.controller';
    readonly notebookType = 'wt.notebook';
    readonly label = 'Writing Tool Notebook Controller';
    readonly supportedLanguages = ['wtnote'];

    private executionCommand: ExecutionCommand | null = null;

    private readonly controller: vscode.NotebookController;
    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private notebook: NotebookPanel,
        private serializer: WTNotebookSerializer
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

        // Function to run the `executeHandler` function on a cell with a specific command
        // NOTE: all of these commands must be inside of an `executeHandler` because that is the only
        //      place in the code where it is safe to begin a cell execution and cell executions are 
        //      the only way to give error messages beneath cells, if necessary
        const executeCellWithCommand = (cell: vscode.NotebookCell | null, executionCommand: ExecutionCommand) => {
            cell = this.getSelectedCell(cell);
            if (!cell) return;
            
            if (vscode.window.activeNotebookEditor && vscode.window.activeNotebookEditor.notebook) {
                this.executionCommand = executionCommand;
                return this.executionHandler([cell], vscode.window.activeNotebookEditor.notebook, this.controller);
            }
        }

        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.convertToHeader", (cell) => executeCellWithCommand(cell, "convertToHeader")));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.editHeader", (cell) => executeCellWithCommand(cell, "editHeader")));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.editCell", (cell) => executeCellWithCommand(cell, "editCell")));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.cell.editNoteTitle", (cell) => executeCellWithCommand(cell, "editTitle")));
    }

    private getSelectedCell (cell: vscode.NotebookCell | null): vscode.NotebookCell | null {
        if (cell) return cell;
        if (!vscode.window.activeNotebookEditor) return null;
        if (vscode.window.activeNotebookEditor.selection.start !== vscode.window.activeNotebookEditor.selection.end - 1) {
            // Start and end are indexes into the cell array.  To use this method without a cell passed in, there
            //      need to be exactly one cell selected
            return null;
        }
        const notebookEditor = vscode.window.activeNotebookEditor;
        return notebookEditor.notebook.cellAt(notebookEditor.selection.start)
    }


    // Called on a wtnote Code cell -- if that cell has content on exactly one line,
    //      then that cell will be swapped out for a 'header' cell, and the cells 
    //      beneath it will be treated as its children
    private async transformToHeader (execution: vscode.NotebookCellExecution, cell: vscode.NotebookCell, document: vscode.NotebookDocument): Promise<boolean> {
        const noteId = (document.metadata as NotebookMetadata).noteId;

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
            return false;
        }

        const headerText = fullLines[0];

        const headerCellData = new vscode.NotebookCellData(
            vscode.NotebookCellKind.Markup,
            await this.serializer.getCellContent(noteId, headerText, 'header', 'markdown'),
            'markdown'
        );
        headerCellData.metadata = __<NotebookCellMetadata>({
            kind: 'header',
            originalText: headerText,
        });
        await this.updateCells(cell.index, headerCellData, document);
        return true;
    }

    private async getNewName (
        cell: vscode.NotebookCell, 
        targetCellKind: Exclude<NotebookCellMetadata['kind'], 'instructions'>,
        execution: vscode.NotebookCellExecution
    ): Promise<string | null> {
        let originalText: string;
        try {
            // To call `editHeader` on a cell, that cell must have been created by `notebookSerializer.deserializeNotebook`
            // In that case, there must be a `metadata` object of type `NotebookCellMetadata` with kind === 'header'
            // If any of that is not the case, then stop now
            const metadata = cell.metadata! as NotebookCellMetadata;
            if (metadata.kind !== targetCellKind) {
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
                    vscode.NotebookCellOutputItem.stderr(`[WARN] Can only call this on '${targetCellKind}' notebook cells`)
                ])
            ]);
            return null;
        }

        // If this is a valid cell to call editHeader on, then query the user for the updated header text value
        const newName = await vscode.window.showInputBox({
            placeHolder: originalText,
            prompt: `What would you like to rename '${originalText}'?`,
            ignoreFocusOut: false,
            value: originalText,
            valueSelection: [0, originalText.length]
        });
        return newName || null;
    }

    // Called on markdown cell with metadata.kind === 'header'
    // Used to change the text of the header cell in the notebook and the NotebookPanel
    private async editNoteHeaderText (execution: vscode.NotebookCellExecution, cell: vscode.NotebookCell, document: vscode.NotebookDocument): Promise<boolean> {
        return this.editNoteHeader___impl(execution, 'header', cell, document);
    }
    
    // Called on markdown cell with metadata.kind === 'header-title'
    // Used to change the title of the note
    // Will also ask the user if they would like to replace all instances of this title throughout the work
    private async editNoteTitleText (execution: vscode.NotebookCellExecution, cell: vscode.NotebookCell, document: vscode.NotebookDocument): Promise<boolean> {
        return this.editNoteHeader___impl(execution, 'header-title', cell, document);
    }

    private async editNoteHeader___impl (
        execution: vscode.NotebookCellExecution, 
        cellKind: 'header' | 'header-title', 
        cell: vscode.NotebookCell, 
        document: vscode.NotebookDocument
    ): Promise<boolean> {
        
        const newTitleName = await this.getNewName(cell, cellKind, execution);
        if (!newTitleName) return false;

        const noteId = (document.metadata as NotebookMetadata).noteId;
        const markdownCellText = await this.serializer.getCellContent(noteId, newTitleName, cellKind, 'markdown');
        const updatedCell = new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, markdownCellText, 'markdown');
        updatedCell.metadata = __<NotebookCellMetadata>({
            kind: cellKind,
            originalText: newTitleName
        });
        await this.updateCells(cell.index, updatedCell, document);
        return true;
    }



    // Called on a markdown cell with metadata.kind === 'input'
    // Used to convert the markdown cell back into its wtnote Code cell equivalent so that the user
    //      can then update contents
    private async transformToWTNote (execution: vscode.NotebookCellExecution, cell: vscode.NotebookCell, document: vscode.NotebookDocument): Promise<boolean> {
        const noteId = (document.metadata as NotebookMetadata).noteId;

        const cellMetadata = cell.metadata as NotebookCellMetadata | undefined;
        if (cellMetadata && 'kind' in cellMetadata && cellMetadata.kind !== 'input') {
            // Should never be called
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stderr("[WARN] Cannot edit headers. Either delete this header or select 'Edit header'")
                ])
            ]);
            execution.end(true, Date.now());
            return false;
        }
        
        await this.toggleInputCellMode(noteId, cell, document);
        return true;
    }

    // When an execute operation is called on a wtnote Code cell, we want to swap that cell
    //      out for a markdown cell
    private async execute(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
        update: boolean = true
    ): Promise<boolean> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.start(Date.now());

        const noteMetadata = notebook.metadata as NotebookMetadata;
        const command = this.executionCommand;

        if (command !== undefined && command !== null) {
            let result: Promise<boolean>;
            switch (command) {
                case 'editTitle': result = this.editNoteTitleText(execution, cell, notebook); break;
                case 'editHeader': result = this.editNoteHeaderText(execution, cell, notebook); break;
                case 'convertToHeader': result = this.transformToHeader(execution, cell, notebook); break;
                case 'editCell': result = this.transformToWTNote(execution, cell, notebook); break;
            }
            execution.end(true, Date.now());
            return result;
        }
        
        // If there is no cell metadata, all we can do is assume that the cell is a regular input cell
        // Cell metadata is missing on new cells created by the user
        const cellMetadata = cell.metadata as NotebookCellMetadata | undefined;
        if (cellMetadata && 'kind' in cellMetadata && cellMetadata.kind !== 'input') {
            // If there is cell metadata, but it's not of the appropriate type to toggle mode
            //      return normally, do not report any errors
            execution.end(true, Date.now());
            return true;
        }
        
        // The only other operation left is to toggle the input cell's mode
        await this.toggleInputCellMode(noteMetadata.noteId, cell, notebook);
        execution.end(true, Date.now());
        return true;
    }


    private async executionHandler(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        controller: vscode.NotebookController
    ): Promise<void> {
        let allSucceeded = true;
        for (let cell of cells) {
            // Since we may be updating more than one cell, we call execute with update=false,
            //      so that all the updates can be applied at once before we manually call
            //      `reopenNotebook` at the end of this method
            const success = await this.execute(cell, notebook, false);
            if (!success) {
                allSucceeded = false;
            }
        }

        this.executionCommand = null;
        this.notebook.refresh(true);
    }


    public async toggleInputCellMode (noteId: string, cell: vscode.NotebookCell, notebook: vscode.NotebookDocument) {
        const metadata = cell.metadata as NotebookCellMetadata | any;

        let content: string;
        let toggledToKind: vscode.NotebookCellKind;
        let languageId: string;

        // Since each cell metadata is supposed to the store the source text for that cell (lang=wtNote), 
        //      we need to track not only what the content will be after conversion but also
        //      the wtNote text
        let internalContent: string;

        if (cell.kind === vscode.NotebookCellKind.Code) {
            internalContent = cell.document.getText();
            content = await this.serializer.getCellContent(noteId, internalContent, 'input', 'markdown');
            toggledToKind = vscode.NotebookCellKind.Markup;
            languageId = 'markdown';
        }
        else if (cell.kind === vscode.NotebookCellKind.Markup) {
            internalContent = metadata?.originalText || this.serializer.convertMarkdownCellToWTNoteText(cell.document.getText());
            content = internalContent;
            toggledToKind = vscode.NotebookCellKind.Code;
            languageId = 'wtnote';
        }
        else throw 'unreachable';

        const updatedCell = new vscode.NotebookCellData(toggledToKind, content, languageId);
        updatedCell.metadata = __<NotebookCellMetadata>({
            kind: 'input',
            markdown: toggledToKind === vscode.NotebookCellKind.Markup,
            originalText: internalContent,
        });
        return this.updateCells(cell.index, updatedCell, notebook);
    }


    public async updateCells (
        replaceCellIdx: number,
        replacement: vscode.NotebookCellData[],
        notebook: vscode.NotebookDocument,
        preventSave?: boolean,
    ): Promise<void>;
    
    public async updateCells (
        replaceCellIdx: number,
        replacement: vscode.NotebookCellData,
        notebook: vscode.NotebookDocument,
        preventSave?: boolean,
    ): Promise<void>;

    public async updateCells (
        replaceCells: vscode.NotebookRange,
        replacement: vscode.NotebookCellData[],
        notebook: vscode.NotebookDocument,
        preventSave?: boolean,
    ): Promise<void>;

    public async updateCells (
        replaceCellsOrCell: number | vscode.NotebookRange,
        replacement: vscode.NotebookCellData[] | vscode.NotebookCellData,
        notebook: vscode.NotebookDocument,
        preventSave?: boolean
    ): Promise<void> {

        let replaceRange: vscode.NotebookRange;
        if (typeof replaceCellsOrCell === 'number') {
            replaceRange = new vscode.NotebookRange(replaceCellsOrCell, replaceCellsOrCell + 1);
        }
        else {
            replaceRange = replaceCellsOrCell;
        }

        let replacementCellsArray: vscode.NotebookCellData[];
        if (Array.isArray(replacement)) {
            replacementCellsArray = replacement;
        }
        else {
            replacementCellsArray = [ replacement ];
        }

        const notebookEdit = new vscode.NotebookEdit(replaceRange, replacementCellsArray);
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(notebook.uri, [notebookEdit]);

        try {
            const editsApplied = await vscode.workspace.applyEdit(workspaceEdit);
            if (!editsApplied) {
                throw "workspace.applyEdit returned false";
            }
        }
        catch (err: any) {
            vscode.window.showErrorMessage(`[ERR] Could not apply edit to notebook document: ${err}`);
            throw err;
        }

        if (!preventSave) {
            await notebook.save();
        }

        // Force the link provider to refresh links on all active text editors
        await this.notebook.forceLinkProviderRefresh();

        // Assign tab labels again
        return TabLabels.assignNamesForOpenTabs();
    }

    public async reopenNotebook (notebook: vscode.NotebookDocument) {
            await notebook.save();
    
            // Store the view column of this notebook so that it can be reopened
            //      in the same location that it was closed
            const viewColumn = vscode.window.activeNotebookEditor!.viewColumn!;
    
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
            await vscode.commands.executeCommand('vscode.openWith', notebook.uri, 'wt.notebook', {
                viewColumn: viewColumn,
            });
    
            // Force the link provider to refresh links on all active text editors
            // This is in case the reopenNotebook operation was called in response
            //      to an alias text box being updated (links to aliases will need
            //      to corresponse with actual aliases)
            await this.notebook.forceLinkProviderRefresh();
    
            // Assign tab labels again
            return TabLabels.assignNamesForOpenTabs();
        }
}