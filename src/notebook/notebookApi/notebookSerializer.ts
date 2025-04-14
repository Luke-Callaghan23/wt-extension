import * as extension from '../../extension';
import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import { BulletPoint, Note, Notebook, NoteSection } from '../notebook';
import { Buff } from '../../Buffer/bufferSource';
import { wtToMd } from '../../export/wtToMd';
import { TabLabels } from '../../tabLabels/tabLabels';
import { capitalize } from '../../intellisense/common';

type NoteId = string;
export type DiskCellMetadata = { editing: boolean };
export type DiskCellText = { text: string };
export type SerializedCell = DiskCellText & DiskCellMetadata;
type CellSection = "title" | "alias" | "appearance" | "note";

export type Concatenate<S1 extends string, S2 extends string> = `${S1}${S2}`;
export type HeaderCellKind = 'header' | 'header-title';
export type NotebookCellMetadata = {
    kind: 'input';
    markdown: boolean;
    originalText: string;
} | {
    kind: 'header' | 'header-title';
    originalText: string;
};


export type NotebookMetadata = {
    noteId: string,
    modifications: Record<number, NotebookCellMetadata>
};

export type SerializedHeader = {
    headerOrder: number,
    headerText: string,
    cells: SerializedCell[]
};

export type SerializedNote = {
    noteId: string;
    title: SerializedCell;
    headers: SerializedHeader[]
};

async function readSingleNote (buffer: ArrayBufferLike): Promise<SerializedNote> {
    const text = extension.decoder.decode(buffer);
    const serializedNote: SerializedNote = JSON.parse(text);
    return serializedNote;
}

export class WTNotebookSerializer implements vscode.NotebookSerializer {
    // constructor

    private context: vscode.ExtensionContext;
    private workspace: Workspace;
    private notebook: Notebook;
    private finishedInitialization: boolean;

    constructor () {
        this.context = {} as any;
        this.workspace = {} as any;
        this.notebook = {} as any;
        this.finishedInitialization = false;
    }


    async init (
        context: vscode.ExtensionContext,
        workspace: Workspace,
        notebook: Notebook,
    ) {
        this.context = context;
        this.workspace = workspace;
        this.notebook = notebook;
        this.finishedInitialization = true;
    }

    deserializeHeaderText (text: string): string {
        return text
            .toLowerCase()
            .trim()
            .replace(/^#+?\s+/, '')
            .replace(/:$/, '');
    }

    
    async readNotebook (notebookFolder: vscode.Uri): Promise<Note[]> {
        const readPromises: PromiseLike<Note>[] = [];
        for (const [ fileName, type ] of await vscode.workspace.fs.readDirectory(notebookFolder)) {
            if (type !== vscode.FileType.File) {
                continue;
            }
            const uri = vscode.Uri.joinPath(notebookFolder, fileName);
            readPromises.push(
                vscode.workspace.fs.readFile(uri)
                .then(readSingleNote)
                .then((serializedNote) => {
                    
                    
                    const aliasesHeaderIndex = serializedNote.headers.findIndex(head => {
                        const aliasText = this.deserializeHeaderText(head.headerText)
                        return aliasText === 'alias' || aliasText === 'aliases';
                    });

                    let serializedAliasHeader: SerializedHeader | null = null;
                    if (aliasesHeaderIndex >= 0) {
                        const spliced = serializedNote.headers.splice(aliasesHeaderIndex, 1);
                        serializedAliasHeader = spliced[0];
                    }
                    serializedNote.headers.sort((a, b) => a.headerOrder - b.headerOrder)

                    const cellsToStrings = (cells: SerializedCell[]): string[] => {
                        return cells.map(cell => {
                            return cell.text
                                .split("\n")
                                .map(line => line.trim())
                                .filter(line => line.length > 0)
                            ;
                        }).flat();
                    }

                    const cellsToBullets = (sectionIdx: number, cells: SerializedCell[]): BulletPoint[] => {
                        return cellsToStrings(cells).map((bullet, index) => {
                            return {
                                kind: 'bullet',
                                idx: index,
                                noteId: serializedNote.noteId,
                                sectionIdx: sectionIdx,
                                text: bullet
                            }
                        })
                        
                    }
                    
                    return {
                        kind: "note",
                        noteId: serializedNote.noteId,
                        title: serializedNote.title.text,
                        aliases: serializedAliasHeader?.cells 
                            ? cellsToStrings(serializedAliasHeader.cells)
                            : []
                        ,
                        sections: serializedNote.headers.map((section, index) => ({
                            kind: 'section',
                            noteId: serializedNote.noteId,
                            idx: index,
                            header: capitalize(section.headerText.trim()),
                            bullets: cellsToBullets(index, section.cells),
                        })),
                        uri: uri,
                    };
                })
            );
        }
        return Promise.all(readPromises);
    }

    async writeSingleNote (note: Note): Promise<vscode.Uri> {
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
    async serializeSingleNote (note: Note): Promise<SerializedNote> {
        const diskContents = await vscode.workspace.fs.readFile(
            vscode.Uri.joinPath(this.workspace.notebookFolder, `${note.noteId}.wtnote`)
        );
        const serializedDiskNote = await readSingleNote(diskContents);
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
                    })
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

    async deserializeNotebook(content: Uint8Array): Promise<vscode.NotebookData> {
        while (!this.finishedInitialization) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const serializedNote = await readSingleNote(content);
        const serialiedCellToCellData = (serializedCell: SerializedCell, kind: CellSection): vscode.NotebookCellData => {
            if (serializedCell.editing) {
                const metadata: NotebookCellMetadata = {
                    kind: 'input',
                    markdown: false,
                    originalText: serializedCell.text
                };
                return {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: 'wtnote',
                    value: serializedCell.text,
                    metadata: metadata
                }
            }
            else {
                const metadata: NotebookCellMetadata = {
                    kind: 'input',
                    markdown: true,
                    originalText: serializedCell.text,
                }
                return {
                    kind: vscode.NotebookCellKind.Markup,
                    languageId: 'markdown',
                    value: wtToMd("- " + serializedCell.text.trim().replaceAll(/\n+/g, "\n\n- ")),
                    metadata: metadata
                }
            }
        };

        const textToCell = (arr: SerializedCell[], kind: CellSection): vscode.NotebookCellData[] => {
            if (arr.length !== 0) {
                return arr.map(cell => serialiedCellToCellData(cell, kind));
            }
            else {
                const metadata: NotebookCellMetadata = {
                    kind: 'input',
                    markdown: false,
                    originalText: "",
                };
                return [{
                    kind: vscode.NotebookCellKind.Code,
                    value: "",
                    languageId: 'wtnote',
                    metadata: metadata
                }];
            }
        };

        serializedNote.headers.sort((a, b) => a.headerOrder - b.headerOrder);


        const titleMetadata: NotebookCellMetadata = { 
            kind: 'header-title',
            originalText: serializedNote.title.text
        };

        const title: vscode.NotebookCellData = {
            kind: vscode.NotebookCellKind.Markup,
            languageId: 'markdown',
            value: `# ${wtToMd(serializedNote.title.text)}:`,
            metadata: titleMetadata,
        };

        const notebookData = new vscode.NotebookData([
            title,

            ...serializedNote.headers.map(header => {
                const headerMetadata: NotebookCellMetadata = {
                    kind: 'header',
                    originalText: header.headerText,
                };
                return [
                    {
                        kind: vscode.NotebookCellKind.Markup,
                        languageId: 'markdown',
                        value: `### ${capitalize(header.headerText)}:`,
                        metadata: headerMetadata,
                    },
                    ...textToCell(header.cells, 'alias'),
                ];
            })
        ].flat());
        const notebookMetadata: NotebookMetadata = { 
            noteId: serializedNote.noteId,
            modifications: {},
        };
        notebookData.metadata = notebookMetadata;
        TabLabels.assignNamesForOpenTabs();
        return notebookData;
    }   

    async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
        // Convert your notebook data back to bytes

        const notebookMetadata: NotebookMetadata = data.metadata! as any;
        const noteId = notebookMetadata.noteId;

        type HeaderBucket = string;
        const headerBuckets: Record<HeaderBucket, SerializedCell[]> = {
            "header-title": [],
        };
        const headerMetadata: Record<HeaderBucket, {
            originalText: string,
            currentText: string
            index: number,
        }> = {
            'header-title': {
                currentText: 'tmp',
                originalText: 'tmp',
                index: 0
            },
        };

        // Since it is required to have exactly one item in the title bucket at the end of processing
        //      we need to pay attention to where the 'header-title' cell is
        // Whatever cell comes directly after that cell is the title cell, no matter what
        // If there is no header-title, the user was annoying and deleted it
        // So, if there is any non-header cell at the top of the document, that cell is used
        // If the title header cell was deleted and the top cell of the document is another header
        //      then there's nothing I can do for you :*(
        let titleHeaderIndex: number = -1;
        let lastHeader: string = 'header-title';

        for (let index = 0; index < data.cells.length; index++) {
            const cell = data.cells[index];
            const cellMetadata = notebookMetadata.modifications[index] || (cell.metadata as NotebookCellMetadata | undefined);
            if (cellMetadata && cellMetadata.kind === 'header') {
                lastHeader = this.deserializeHeaderText(cell.value);
                // If the header is not in the indexes map, then use the current length of the header
                //      buckets to assign the index
                if (!headerMetadata[lastHeader]) {
                    // NOTE: can't be included in the same if statement as below because sometimes the 'notes'
                    //      bucket is manually created in this loop
                    // When it is manually created, it will exist in headerBuckets but not in headerIndexes
                    // Usually, this means that at the end of this loop 'notes' will automatically be assigned
                    //      the bucket index all the way at the end of the document
                    // BUT if there is a case where 'notes' is manually created but there is also an existing
                    //      'notes' bucket in the document, we want to use that index for both
                    // (The next if statement won't be hit if lastHeader==='notes' and 'notes' was manually created
                    //      but we still want to retain this index)
                    headerMetadata[lastHeader] = {
                        index: Object.keys(headerBuckets).length,
                        currentText: cell.value,
                        originalText: cellMetadata.originalText,
                    };
                }
                // And if it is not in the header buckets, then create an empty array
                if (!headerBuckets[lastHeader]) {
                    headerBuckets[lastHeader] = [];
                }
                continue;
            }

            if (cellMetadata && cellMetadata.kind === 'header-title') {
                titleHeaderIndex = index;
                lastHeader = 'header-title';
            }

            const getDiskCell = (cell: vscode.NotebookCellData, metadata: NotebookCellMetadata | undefined): SerializedCell => {
                let text: string | undefined;
                
                if (cell.kind === vscode.NotebookCellKind.Code || (cell.outputs && cell.outputs.length > 0)) {
                    let isEditing: boolean;
                    if (cell.kind === vscode.NotebookCellKind.Code) {
                        if (cell.outputs && cell.outputs.length > 0) {
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

            // If the previous header was the title header, then this is the title cell
            if (lastHeader === 'header-title' && titleHeaderIndex !== -1 && titleHeaderIndex + 1 === index) {
                if (headerBuckets['header-title'].length > 0) {
                    vscode.window.showWarningMessage(`Moving ${headerBuckets['header-title'].length} cells from the "Title" section to the "Notes" section because changed the order of stuff. >:(`);
                }

                if (!headerBuckets['notes']) {
                    headerBuckets['notes'] = [];
                }

                // Concat the "notes" bucket with anything that exists in the "title" bucket right now
                headerBuckets['notes'] = headerBuckets['notes'].concat(headerBuckets['header-title']);
                // Empty out the "title" bucket
                headerBuckets['header-title'] = [];
            }
            headerBuckets[lastHeader].push(getDiskCell(cell, cellMetadata));
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
            vscode.window.showWarningMessage(`Moving ${remaining.length} cells from the "Title" section to the "Notes" section because changed the order of stuff. >:(`);
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

        if (headerBuckets['header-title']) {
            delete headerBuckets['header-title'];
        }

        const sortedHeaders = Object.entries(headerBuckets).sort(([ headerTextA, _a ], [ headerTextB, _b ]) => {
            return headerMetadata[headerTextA].index - headerMetadata[headerTextB].index;
        });
        
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
        const json = JSON.stringify(fullySerialized, undefined, 4);
        return new TextEncoder().encode(json);
    }
}



