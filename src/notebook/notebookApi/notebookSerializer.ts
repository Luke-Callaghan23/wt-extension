import * as extension from '../../extension';
import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import { BulletPoint, NotebookPanelNote, NotebookPanel, NoteSection } from '../notebookPanel';
import { Buff } from '../../Buffer/bufferSource';
import { wtToMd } from '../../export/wtToMd';
import { TabLabels } from '../../tabLabels/tabLabels';
import { capitalize } from '../../intellisense/common';
import { _, } from '../../miscTools/help';

/*
NOTES on NotebookSerializer and NotebookController and how wtnote files are handled

How the notebook works:
    wtnote files are edited using a notebook editor, where the contents are separated into
        different sections under Markdown formatted header cells
    In the NotebookPanel, these headers are displayed as foldable tree items and the 
        cells underneath are displayed as bullet points
    Whena user 'executes' a wtnote cell in a notebook, that cell is swapped out for 
        a markdown cell with bullet points displayed in the markdown
    To modify or add a header, you can use special commands created for those operations

How it is done:
    Since there is no real API to modify the contents of a notebook in VScode directly,
        WTANIWE needs to use some janky workarounds to perform updates
    Mainly, this is done through the NotebookController updating cell metadata
        When the controller wants to make a change to the content, it stores those changes
            in the updated cell's output metadata 
                ^^ updates are stored in output metadata because the controller is blocked from
                    modifying cell metadata -- output metadata is really the only thing it can change

    Once changes are stored in metadata, the document is saved
        Saving the document calls NotebookSerializer.serializeNotebook which will read
            the metadata created by NotebookController and reflect those changes in
            the wtnote file on the file system
    Once saved, it closes the document
    Finally, it reopens the document in the same location and tab where it was just opened
        Opening the document will lead to the changes written by serializeNotebook being
            read by NotebookSerializer.deserializeNotebook and reflected in the actual
            cells of the document

See NotebookController.reopenNotebook for how reopening is done
See NotebookSerializer.serializeNotebook to see how the serializer reads metadata updates
    from the NotebookController and reflects those changes in the wtnote file
*/




export type NotebookMetadata = {
    noteId: string,
};



export type NotebookCellMetadata = {
    // Headers are used as the main sections in the Notebook panel and cannot be 
    //      modified directly by the user
    // The user can modify header text with "wt.notebook.cell.editHeader"
    // But double clicking on the Markdown cell and editing there does nothing
    kind: 'header' | 'header-title';
    originalText: string;
} | {
    // Inputs are the main bodies (bullet points) of a note, displayed under the headers
    //      in the NotebookPanel
    // Inputs operate in two main modes -- markdown and wtnote
    // When in markdown mode, the text is unmodifiable and displayed as markdown in the notebook
    // When in wtnote mode, the user is modifying the text of cell
    // The controller can swap between the two modes by:
    //      in wtnote mode   --> execute the cell
    //      in markdown mode --> "wt.notebook.cell.editCell"
    kind: 'input';
    originalText: string;
    
    // Markdown indicates whether or not the user is currently able to edit the contents
    markdown: boolean;                      
};



export type SerializedNote = {
    noteId: string;
    title: SerializedCell;
    headers: SerializedHeader[]
};


export type SerializedCell = {
    text: string,
    editing: boolean,
};


export type SerializedHeader = {
    headerOrder: number,
    headerText: string,
    cells: SerializedCell[]
};

export type NotebookCellConvertTarget = 'header' | 'markdown' | 'input';


// Cell changes made by the NotebookController are normally are appended to a cell's `output` array
//      and stored in the `metadata` section of an output
// This is the type that describes cell output metadata, created by the controller
export type NotebookCellOutputMetadata = {
    // Indicates that the controller wants to convert this cell into some other targeted type
    convert?: NotebookCellConvertTarget;

    // Indicates that the `originalText` field of a cell needs to be updated before it is written to
    //      the file system
    updateValue?: string;
};

export class WTNotebookSerializer implements vscode.NotebookSerializer {
    // constructor

    private context: vscode.ExtensionContext;
    private workspace: Workspace;
    private notebookPanel: NotebookPanel;
    private finishedInitialization: boolean;

    // Initialized with empty data
    // Need the serializer to be created before anything else because
    //      - An open notebook will initially display an error if `vscode.workspace.registerNotebookSerializer` is not one of the 
    //              first things called after extension activation
    //      - `deserializeNotebookPanel` is required in NotebookPanel initialization
    // So, start a fake initialization now then actually init once NotebookPanel is finished
    constructor () {
        this.context = {} as any;
        this.workspace = {} as any;
        this.notebookPanel = {} as any;
        this.finishedInitialization = false;
    }

    // Only called after the NotebookPanel is finished initializing
    async init (
        context: vscode.ExtensionContext,
        workspace: Workspace,
        notebook: NotebookPanel,
    ) {
        this.context = context;
        this.workspace = workspace;
        this.notebookPanel = notebook;
        this.finishedInitialization = true;
    }

    
    //#region SERIALIZE OBJECTS

    // Copies changes serialized by this.serializeNotebook into the notebook panel
    private propagateNoteChanges (serializedNote: SerializedNote) {
        const updatedPanelNote = this.deserializeNote(serializedNote);
        let replaceIndex = this.notebookPanel.notebook.findIndex(panelNote => panelNote.noteId === updatedPanelNote.noteId);
        if (replaceIndex < 0) {
            // If the find index operation failed, then just insert this note at the end of the panel notebook
            replaceIndex = this.notebookPanel.notebook.length;
        }
        this.notebookPanel.notebook[replaceIndex] = updatedPanelNote;
        this.notebookPanel.refresh();
    }

    private deserializeHeaderText (text: string): string {
        return text
            .toLowerCase()
            .trim()
            .replace(/^#+?\s+/, '')
            .replace(/:$/, '');
    }
    
    private sectionCellTextToString (cells: SerializedCell[]): string[] {
        return cells.map(cell => {
            return cell.text
                .split("\n")
                .map(line => line.trim())
                .filter(line => line.length > 0)
            ;
        }).flat();
    }

    private sectionCellsToBulletPoints (noteId: string, sectionIdx: number, cells: SerializedCell[]): BulletPoint[] {
        return this.sectionCellTextToString(cells).map((bullet, index) => {
            return {
                kind: 'bullet',
                idx: index,
                noteId: noteId,
                sectionIdx: sectionIdx,
                text: bullet
            };
        });
    }
    

    private deserializeNote (serializedNote: SerializedNote): NotebookPanelNote {
        // serializedNote.headers array may be modified in this function, so get
        //      a copy of the array as it is to work on here
        const copiedSections = [...serializedNote.headers];

        // 'alias' is the single "special" header that the NotebookPanel cares about
        //      and treats differently to other headers and sections
        // It is used to highlight and link to this note when editing a '.wt' document
        // Search for an alias header in the serialized note
        const aliasesHeaderIndex = copiedSections.findIndex(head => {
            const aliasText = this.deserializeHeaderText(head.headerText)
            return aliasText === 'alias' || aliasText === 'aliases';
        });

        // If we found 'alias', store and remove it from the copied array
        let serializedAliasHeader: SerializedHeader | null = null;
        if (aliasesHeaderIndex >= 0) {
            const spliced = copiedSections.splice(aliasesHeaderIndex, 1);
            serializedAliasHeader = spliced[0];
        }
        
        // Sort based on header order
        copiedSections.sort((a, b) => a.headerOrder - b.headerOrder);

        // Create the note
        return {
            kind: "note",
            noteId: serializedNote.noteId,
            title: serializedNote.title.text,
            aliases: serializedAliasHeader?.cells 
                ? this.sectionCellTextToString(serializedAliasHeader.cells)
                : []
            ,
            sections: serializedNote.headers.map((section, index) => ({
                kind: 'section',
                noteId: serializedNote.noteId,
                idx: index,
                header: capitalize(section.headerText.trim()),
                bullets: this.sectionCellsToBulletPoints(serializedNote.noteId, index, section.cells),
            })),
            uri: vscode.Uri.joinPath(extension.globalWorkspace!.notebookFolder, `${serializedNote.noteId}.wtnote`),
        };
    }

    // Read notebook folder from disk and return an array of Notes that can be used by NotebookPanel
    async deserializeNotebookPanel (notebookFolder: vscode.Uri): Promise<NotebookPanelNote[]> {
        const readPromises: PromiseLike<NotebookPanelNote>[] = [];
        for (const [ fileName, type ] of await vscode.workspace.fs.readDirectory(notebookFolder)) {
            if (type !== vscode.FileType.File) {
                continue;
            }

            // Create promises for each note
            const uri = vscode.Uri.joinPath(notebookFolder, fileName);
            readPromises.push(
                vscode.workspace.fs.readFile(uri)               // read content
                .then(this.readSerializedNote.bind(this))       // JSON parse to SerializedNote
                .then(this.deserializeNote.bind(this))          // convert SerializedNote to NotebookPanelNote
            );
        }
        return Promise.all(readPromises);
    }


    async readSerializedNote (buffer: ArrayBufferLike): Promise<SerializedNote> {
        const text = extension.decoder.decode(buffer);
        const serializedNote: SerializedNote = JSON.parse(text);
        return serializedNote;
    };

    async writeSingleNote (note: NotebookPanelNote): Promise<vscode.Uri> {
        const uri = note.uri;
        const serializedNote = this.serializeSingleNote(note);
        const jsonNote = JSON.stringify(serializedNote, undefined, 4);
        await vscode.workspace.fs.writeFile(uri, Buff.from(jsonNote));
        return uri;
    }


    // Rarely used function -- only when some outside command edits the contents of a `Note` object
    //      and those changes need to be forwarded into the serialized note on disk
    // Because of how rare this is used and because of the variety of use cases, we don't honor the 
    //      `editing` status of cells from disk
    // It is hard to match `Note` object `BulletPoint`s to `SerializedCell`s from the disk contents
    //      and backfill the true `editing` status, so we set true to all
    // TODO: Might be able to combat this by doing some matching of `Note` object contents VS disk contents
    //      not sure
    async serializeSingleNote (note: NotebookPanelNote): Promise<SerializedNote> {
        const diskContents = await vscode.workspace.fs.readFile(
            vscode.Uri.joinPath(this.workspace.notebookFolder, `${note.noteId}.wtnote`)
        );
        const serializedDiskNote = await this.readSerializedNote(diskContents);
        return {
            noteId: note.noteId,
            title: {
                text: note.title,
                editing: serializedDiskNote.title.editing
            },
            headers: [
                // Alias is being set to 0th section in the serialized cell... might not be true
                //      for what is on disk right now
                // TODO: see if we can maybe find the correct location for alias according to 
                //      serialized content on disk
                {
                    headerText: 'alias',
                    headerOrder: 0,
                    cells: note.aliases.map(alias => {
                        return {
                            editing: true,
                            text: alias
                        }
                    }),
                },
                // Insert the remaining headers in the order they are on disk.
                // Should be more or less accurate to disk contents
                ...note.sections.map((section, sectionIndex) => {
                    return {
                        cells: section.bullets.map(bullet => {
                            return {
                                editing: true,
                                text: bullet.text
                            }
                        }),
                        headerOrder: sectionIndex + 1,
                        headerText: section.header
                    }
                })
            ]
        }
    }

    //#endregion


    //#region SERIALIZE CELLS

    private getCelldata (serializedCell: SerializedCell): vscode.NotebookCellData {
        if (serializedCell.editing) {
            // If the cell is being edited, then return a vscode.NotebookCellData with kind===Code
            return {
                kind: vscode.NotebookCellKind.Code,
                languageId: 'wtnote',
                value: serializedCell.text,
                metadata: _<NotebookCellMetadata>({
                    kind: 'input',
                    markdown: false,
                    originalText: serializedCell.text
                })
            }
        }
        else {
            // If the cell is not being edited, then conver the text of the cell into its markdown equivalent
            //      and return a vscode.NotebookCelldata using kind===Markup
            return {
                kind: vscode.NotebookCellKind.Markup,
                languageId: 'markdown',
                value: wtToMd("- " + serializedCell.text.trim().replaceAll(/\n+/g, "\n\n- ")),
                metadata: _<NotebookCellMetadata>({
                    kind: 'input',
                    markdown: true,
                    originalText: serializedCell.text,
                }),
            }
        }
    };

    // Called on the children of a header that is read from serialized file
    private deserializeCell (arr: SerializedCell[]): vscode.NotebookCellData[] {
        if (arr.length !== 0) {
            // If the header does not have any children, then make an empty child cell for it
            return [{
                kind: vscode.NotebookCellKind.Code,
                value: "",
                languageId: 'wtnote',
                metadata: _<NotebookCellMetadata>({
                    kind: 'input',
                    markdown: false,
                    originalText: "",
                })
            }];
        }
        
        // Otherwise iterate over all cells and get cell data for each
        return arr.map(cell => this.getCelldata(cell));
    };

    async deserializeNotebook(content: Uint8Array): Promise<vscode.NotebookData> {
        while (!this.finishedInitialization) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Read and sort the contents of the note from disk
        const serializedNote = await this.readSerializedNote(content);
        serializedNote.headers.sort((a, b) => a.headerOrder - b.headerOrder);
        
        // Create the title cell at the top of the document
        const title: vscode.NotebookCellData = {
            kind: vscode.NotebookCellKind.Markup,
            languageId: 'markdown',
            value: `# ${wtToMd(serializedNote.title.text)}:`,
            metadata: _<NotebookCellMetadata>({ 
                kind: 'header-title',
                originalText: serializedNote.title.text
            }),
        };

        const notebookData = new vscode.NotebookData([
            title,

            // For each header:
            serializedNote.headers.map(header => {
                return [
                    // Create the header cell itself as a markdown cell
                    {
                        kind: vscode.NotebookCellKind.Markup,
                        languageId: 'markdown',
                        value: `### ${capitalize(header.headerText)}:`,
                        metadata: _<NotebookCellMetadata>({
                            kind: 'header',
                            originalText: header.headerText,
                        }),
                    },

                    // Then deserialize all the contents under this header
                    ...this.deserializeCell(header.cells),
                ];
            // Then flatten the contents into the main array
            }).flat()
        ].flat());

        // Only metadata needed for the main notebook is the id
        notebookData.metadata = _<NotebookMetadata>({
            noteId: serializedNote.noteId,
        });
        // Whenever a notebook is opened, set the tab name
        TabLabels.assignNamesForOpenTabs();
        return notebookData;
    }

    // Convert cells in a wtnote notebook document into a SerializedNote array buffer
    // NOTE: all cell conversions and edits are communicated from the notebook controller
    //      to this serializer function through two methods:
    //          cell metadata  -- see type `NotebookCellMetadata`
    //          cell outputs   -- see type `NotebookCellOutputMetadata`
    // Those changes are added to cells in the controller, and this function writes those
    //      changes to the notebook wtnote file
    // Then, usually, the controller closes this document, then reopens it
    // When reopened, this.deserializeNotebook is called using the new wtnote file contents
    //      and the notebook contents will be updated
    // This is one large workaround while the VS Code notebook API is still in its early stages
    // And all of this will hopefully change if the API is built out more
    async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
        const notebookMetadata: NotebookMetadata = data.metadata! as any;
        const noteId = notebookMetadata.noteId;

        // Notebook serialization is done by bucketing all cells into groups denoted by 'header' cells
        // When the serializer encounters a cell with metadata that has kind === 'header', all cells 
        //      below that cell are considered children of that header (and will be displayed as such
        //      in the wtnote document as well as the NotebookPanel), until the serializer encounters 
        //      another 'header' cell
        // 

        type HeaderBucket = string;
        const headerBuckets: Record<HeaderBucket, SerializedCell[]> = {
            "header-title": [],
        };
        const headerMetadata: Record<HeaderBucket, {
            originalText: string,
            currentText: string
            index: number,
        }> = {
            // Temp header title... will be replaced in the loop below
            'header-title': {
                currentText: 'tmp',
                originalText: 'tmp',
                index: 0
            },
        };

        let lastHeader: string = 'header-title';

        // 
        for (let index = 0; index < data.cells.length; index++) {
            const cell = data.cells[index];
            let cellMetadata: NotebookCellMetadata | undefined = cell.metadata as any;

            const convertTarget = this.getCellConvertTarget(cell);
            if (convertTarget === 'input') {
                // If convert target is 'input', a markdown cell is being converted to
                //      a wtnote code cell
                // So, the kind needs to remain as 'input', but `markdown` flag is now
                //      set to false
                // Called when 'Edit Cell' is clicked on a markdown cell
                cellMetadata = {
                    kind: 'input',
                    markdown: false,
                    originalText: cellMetadata!.originalText
                };
            }
            else if (convertTarget === 'header') {
                // When the convert target is 'header', then change the kind of this cell
                //      to header and overwrite `originalText` to the current value of the 
                //      input cell
                // This is called when the 'Convert to Header' is clicked on a wtnote cell
                // `originalText` is overwritten because this is the value used by the 
                //      serializer to set the text value of the header
                cellMetadata!.kind = 'header';
                cellMetadata!.originalText = cell.value;
            }

            // Update the `originalText` attribute of the cell metadata if the controller
            //      has indicated a new value is needed
            // This happens when someone manually updates the text of a header cell
            const updatedText = this.getUpdatedText(cell);
            if (updatedText) {
                cellMetadata!.originalText = updatedText;
            }

            if (cellMetadata && cellMetadata.kind === 'header') {
                // If the current cell is a header, then create a bucket for it in the header buckets as well
                //      as a metadata object
                // Header key and text is taken from the original text field of the cell's metadata
                lastHeader = cellMetadata.originalText;

                // If this header is not known to the serializer yet, then create metadata for it
                //      and an empty bucket to store the next cells
                if (!headerBuckets[lastHeader]) {
                    headerMetadata[lastHeader] = {
                        // Index is the last index of the header buckets (end of the list)
                        index: Object.keys(headerBuckets).length,
                        currentText: cell.value,
                        originalText: cellMetadata.originalText,
                    };

                    // And if it is not in the header buckets, then create an empty array
                    headerBuckets[lastHeader] = [];
                }
                continue;
            }

            if (cellMetadata && cellMetadata.kind === 'header-title') {
                lastHeader = 'header-title';
            }
            headerBuckets[lastHeader].push(this.getSerializedCell(cell, cellMetadata));
        }

        // No cells in the header bucket -- nothing I can do.  Have to emit an error and hope the user
        //      will fix it on the next
        if (headerBuckets['header-title'].length === 0) {
            throw `Unable to find an appropriate title cell for this document.  Please add a cell at the top of the document with the title of this note and try again.  Stop rearranging stuff!!! >:(`
        }
        
        const titleCell: SerializedCell = headerBuckets['header-title'][0];
        // Title cell can only have one line worth of content
        titleCell.text = titleCell.text.split("\n")[0].trim();

        if (headerBuckets['header-title'].length > 1) {
            if (!headerBuckets['notes']) {
                headerBuckets['notes'] = [];
            }

            // If there is more than one cell under the title header, we have to move everything that is not the first one into
            //      the notes bucket
            const remaining = headerBuckets['header-title'].slice(1);
            vscode.window.showWarningMessage(`Moving ${remaining.length} cells from the "Title" section to the "Notes" section because you changed the order of stuff. >:(`);
            headerBuckets['notes'] = headerBuckets['notes'].concat(remaining);
        }

        if (headerBuckets['notes'] && !headerMetadata['notes']) {
            // This case is hit when the 'notes' bucket was manually added through some of the bucketing logic above
            // 'notes' is generally a catch-all, so the bucketing process will sometimes manually create the bucket
            // In which case metadata also needs to be manually added
            headerMetadata['notes'] = {
                currentText: '### Notes:',
                originalText: 'notes',
                index: Object.keys(headerBuckets).length
            };
        }

        // The title header is added to the serialized note in different format than all other sections,
        //      so remove it from the header bucket object now
        if (headerBuckets['header-title']) {
            delete headerBuckets['header-title'];
        }

        // Sort by header index
        const sortedHeaders = Object.entries(headerBuckets).sort(([ headerTextA, _a ], [ headerTextB, _b ]) => {
            return headerMetadata[headerTextA].index - headerMetadata[headerTextB].index;
        });
        
        // Finish serializing by iterating header metadata and header buckets
        const fullySerialized: SerializedNote = {
            noteId: noteId,
            title: titleCell,
            headers: sortedHeaders.map(([ headerText, contents ], index) => {
                return {
                    headerText: headerText,
                    cells: contents,
                    headerOrder: index
                }
            })
        };

        // Propogate changes, serialize to JSON, finish
        this.propagateNoteChanges(fullySerialized);
        const json = JSON.stringify(fullySerialized, undefined, 4);
        return new TextEncoder().encode(json);
    }

    
    private getSerializedCell (cell: vscode.NotebookCellData, metadata: NotebookCellMetadata | undefined): SerializedCell {
        let text: string | undefined;
        
        if (cell.kind === vscode.NotebookCellKind.Code || (this.getCellConvertTarget(cell) === 'markdown')) {
            let isEditing: boolean;
            if (cell.kind === vscode.NotebookCellKind.Code) {
                if (this.getCellConvertTarget(cell) === 'markdown') {
                    isEditing = false;
                }
                else {
                    isEditing = true;
                }
            }
            else {
                if (metadata && metadata.kind === 'input' && metadata.originalText) {
                    text = metadata.originalText;
                }
                isEditing = true;
            }
            return {
                editing: isEditing,
                text: text || cell.value
            };
        }
        else {
            if (metadata && metadata.kind === 'input' && metadata.markdown && metadata.originalText) {
                text = metadata.originalText;
            }
            else if (metadata && metadata.kind === 'header-title' && metadata.originalText) {
                text = metadata.originalText;
            }
            else {
                const lines = cell.value
                    .split("\n")                                        // Split lines
                    .map(line => line.trim())                           // Trim
                    .filter(line => line.length > 0)                    // Filter empty lines
                    .map(line => line.replace(/^-\s*/, ""))             // Remove leading '- ' that gets automatically added to markup
                ;
                text = lines.join("\n\n");
            }

            return {
                editing: false,
                text: text
            }
        }
    }


    private getCellConvertTarget (cell: vscode.NotebookCellData): NotebookCellConvertTarget | null {
        if (!cell.outputs) return null;

        for (const output of cell.outputs) {
            const outputMetadata: NotebookCellOutputMetadata | undefined = output.metadata;
            if (!outputMetadata || !outputMetadata.convert) continue;

            // TODO: maybe return something different if thre is more than out output???
            // TODO: don't think that will ever happen, though
            return outputMetadata.convert;
        }
        return null;
    }

    private getUpdatedText (cell: vscode.NotebookCellData): string | null {
        if (!cell.outputs) return null;

        for (const output of cell.outputs) {
            const outputMetadata: NotebookCellOutputMetadata | undefined = output.metadata;
            if (!outputMetadata || !outputMetadata.updateValue) continue;
            return outputMetadata.updateValue;
        }
        return null;
    }
}



