import * as extension from '../../extension';
import * as vscode from 'vscode';
import { Workspace } from '../../workspace/workspaceClass';
import { BulletPoint, NotebookPanelNote, NotebookPanel, NoteSection } from '../notebookPanel';
import { Buff } from '../../Buffer/bufferSource';
import { wtToMd } from '../../export/wtToMd';
import { TabLabels } from '../../tabLabels/tabLabels';
import { capitalize } from '../../miscTools/help';
import { _, formatFsPathForCompare, getRelativePath, statFile, vagueNodeSearch, } from '../../miscTools/help';
import { TextMatchForNote } from '../timedViewUpdate';
import { WTNotebookController } from './notebookController';
import { markdownFormattedFragmentLinkRegex } from '../../miscTools/fragmentLinker';

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
} | {
    // Extra metadata just for the instructions cell
    kind: 'instructions';
};



export type SerializedNote = {
    noteId: string;
    title: SerializedCell;
    deletedInstructions: boolean;
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
    private controller: WTNotebookController;
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
        this.controller = {} as any;
        this.finishedInitialization = false;
    }

    // Only called after the NotebookPanel is finished initializing
    async init (
        context: vscode.ExtensionContext,
        workspace: Workspace,
        notebook: NotebookPanel,
        controller: WTNotebookController
    ) {
        this.context = context;
        this.workspace = workspace;
        this.notebookPanel = notebook;
        this.controller = controller;
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
    
    private sectionCellTextToString (lines: string[], noteId: string, sectionIdx: number): BulletPoint[] {
        const bullets: BulletPoint[] = [];
        
        lines = lines.filter(line => line.trim().length > 0);

        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            if (line.trim().length === 0) {
                continue;
            }

            let current = line;
            let offset = 0;
            const subBullets: string[] = [];
            while (current.startsWith('    ') || current.startsWith('\t')) {
                if (current.startsWith('    ')) {
                    subBullets.push(current.substring(4));
                }
                else {
                    subBullets.push(current.substring(1));
                }
                offset += 1;
                current = lines[index + offset];
                if (!current) break;
            }

            if (subBullets.length > 0 && bullets.length > 0) {
                bullets[bullets.length - 1].subBullets = this.sectionCellTextToString(subBullets, noteId, sectionIdx);

                // If there were any sub bullets, skip past them
                index += subBullets.length - 1;
            }
            else {
                bullets.push({
                    kind: 'bullet',
                    idx: index,
                    noteId: noteId,
                    sectionIdx: sectionIdx,
                    text: line.trim(),
                });
            }
        }
        return bullets;
    }

    private sectionCellsToBulletPoints (noteId: string, sectionIdx: number, cells: SerializedCell[]): BulletPoint[] {
        return cells.map((cell, index) => {
            return this.sectionCellTextToString(cell.text.split(/\n|\r/g), noteId, index);
        }).flat();
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
                ? serializedAliasHeader.cells.map(cell => {
                    return cell.text
                        .split(/\n|\r/g)
                        .map(line => line.trim())
                        .filter(line => line.length > 0)
                }).flat()
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
        const serializedNote = await this.serializeSingleNote(note);
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
        const bulletParse = (bullet: BulletPoint, prefix=''): string => {
            if (bullet.subBullets) {
                return bullet.text + "\n" + bullet.subBullets.map(b => prefix + '    ' + bulletParse(b, prefix + '    ')).join('\n');
            }
            return bullet.text;
        }

        return {
            noteId: note.noteId,
            title: {
                text: note.title,
                editing: false
            },
            deletedInstructions: false,
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
                        cells: section.bullets.map(b => {
                            return {
                                editing: true,
                                text: bulletParse(b)
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

    public async createMarkdownStringFromCellText (wtText: string, noteId: string): Promise<string> {

        // Add '- ' to the beginning of every valid line
        // Replace all sets of four spaces (or one tab character) with two spaces to 
        //      do Markdown formatted bullet indentation
        const withBulletPointsLines: string[] = [];
        for (let line of wtText.trim().split('\n')) {
            // Count how many groups of 4 spaces or tabs come before the text in this line
            let replacements = 0;
            while (line.startsWith("    ") || line.startsWith('\t')) {
                replacements++;

                if (line.startsWith("    ")) {
                    line = line.substring(4)
                }
                else {
                    line = line.substring(1);
                }
            }
            line = line.trim();
            if (line.length === 0) {
                continue;
            }

            // For each 4 space group or tab, fill in two spaces 
            let prefix = '';
            for (let index = 0; index < replacements; index++) {
                prefix += '  ';
            }

            // Add '- ' to turn this into a bullet
            line = prefix + '- ' + line;

            // If this is the first line, then don't add the newline
            withBulletPointsLines.push(line);
        }
        const withBulletPoints = withBulletPointsLines.join('\n');
        
        const replacements: {
            start: number,
            end: number,
            replace: string
        }[] = [];
        let match: RegExpExecArray | null;
        while ((match = markdownFormattedFragmentLinkRegex.exec(withBulletPoints))) {
            if (!match.groups || !match.groups.link || !match.groups.description) {
                continue;
            }

            const start = match.index;
            const end = match.index + match[0].length;

            const { link, description } = match.groups as { 
                link: string;
                description: string;
            };
            const node = await vagueNodeSearch(vscode.Uri.file(link), true);
            if (!node || node.source === 'notebook') continue
            const uri = node.node!.data.ids.uri;

            replacements.push({
                replace: `[${description}](${uri.path})`,
                start: start,
                end: end
            });
        }

        const reversedReplacements = replacements.reverse();
        let withFragmentLinks = withBulletPoints;
        for (const { start, end, replace } of reversedReplacements) {
            const nend = withFragmentLinks.substring(end);
            const nstart = withFragmentLinks.substring(0, start);
            withFragmentLinks = nstart + replace + nend;
        }

        // Convert wt text stylings to md text stylings
        const asMarkdown = wtToMd(withFragmentLinks);
        
        // Search for all references to notes in this cell
        const matches: TextMatchForNote[] = [];
        for (const match of this.notebookPanel.getNoteMatchesInText(asMarkdown)) {
            if (!match.matchedNote) continue;

            // Skip any note that matches this note id
            if (match.matchedNote.noteId === noteId) continue;
            matches.push(match);
        }
        
        // Iterate backwards over all the matched notes in this cell
        const reversedMatches = matches.reverse();
        let finalString: string = asMarkdown;
        for (const { start, end, tag, matchedNote } of reversedMatches) {
            if (!matchedNote) throw 'unreachable';

            const nend = finalString.substring(end);
            const nstart = finalString.substring(0, start);
            const originalMatch = finalString.substring(start, end);

            // Replace the matched text with a markdown-formatted link to that note
            const link = `[${originalMatch}](${matchedNote.uri.path})`;
            finalString = nstart + link + nend;
        }

        return finalString;
    }

    private async getCelldata (serializedCell: SerializedCell, noteId: string): Promise<vscode.NotebookCellData> {
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
                value: await this.createMarkdownStringFromCellText(serializedCell.text, noteId),
                metadata: _<NotebookCellMetadata>({
                    kind: 'input',
                    markdown: true,
                    originalText: serializedCell.text,
                }),
            }
        }
    };

    // Called on the children of a header that is read from serialized file
    private async deserializeCell (arr: SerializedCell[], noteId: string): Promise<vscode.NotebookCellData[]> {
        
        // EMPTY ARRAY:
        if (arr.length === 0) {
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
        const final = [];
        for (const cell of arr) {
            final.push(await this.getCelldata(cell, noteId));
        }
        return final;
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
            })
        };

        const notebookData = new vscode.NotebookData([

            !serializedNote.deletedInstructions ? _<vscode.NotebookCellData>({
                kind: vscode.NotebookCellKind.Code,
                value: ``,
                languageId: 'html',
                metadata: _<NotebookCellMetadata>({ kind: 'instructions' }),
                outputs: [ new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(`
                    <body>
                        <style>
                            li, p { font-size: 17px; }
                        </style>
                        <h1><b>Welcome to WTANIWE notebook</b></h1>
                        <p>Here's how it works:</p>
                        <ul>
                            <li>All instances of this note's title will appear highlighted blue in fragment files and will link here if you ctrl+click on it</li>
                            <li>Write notes about your subject in the notebook cells below, or add more cells with "+ Code" <b>(NOT "+ Markdown"!!)</b></li>
                            <li>When you save the notebook document, your changes notes will appear in the "Notes" panel of the extension and when you hover a notebook term or alias</li>
                            <ul><li>Text on each new line is a bullet point.  To add a sub-bullet insert 4 spaces or a tab character before the text on your line</li></ul>
                            <li>The language of these cells are 'wtnote', which is more or less equivalent to the regular 'wt' you've been using all along, so you have all the same styling and keybindings as usual</li>
                            <li>Headers:</li>
                            <ul>
                                <li>The main tool for organizing details of a wtnote file.</li>
                                <li>Default headers are "Aliases", "Appearance", and "Notes", but you can add more headers selecting an input cell and hitting the fancy looking icon with tooltip "Notebook: Convert Cell to Header"</li>
                                <li>Edit the text of existing headers by clicking on an the header cell and hitting the keyboad icon with tooltip "Notebook: Edit header text"</li>
                            </ul>
                            <li>Cells:</li>
                            <ul>
                                <li>"Execute" a wtnote cell to convert it into nicely formatted bullet point list under a header</li>
                                <li>Modify bullet pointed markdown cells by clicking on the cell, then clicking on the blue icon with "Notebook: Edit cell" tooltip</li>
                                <li>DO NOT double click edit any markdown cells created by this extension.  You probably won't break anything, but your changes will not be saved</li>
                            </ul>
                            <li>Delete this cell whatever you like and it won't appear next time you open this document</li>
                        </ul>
                    </body>`, 'text/html')
                ]) ],
                executionSummary: {
                    executionOrder: 0,
                    success: true,
                    timing: { startTime: 0, endTime: 0 }
                }
            }) : [],

            title,
        ].flat());

        // For each header:
        for (const header of serializedNote.headers) {
            notebookData.cells.push({
                kind: vscode.NotebookCellKind.Markup,
                languageId: 'markdown',
                value: `### ${capitalize(header.headerText)}:`,
                metadata: _<NotebookCellMetadata>({
                    kind: 'header',
                    originalText: header.headerText,
                }),
            });

            // Then deserialize all the contents under this header
            notebookData.cells.push(
                ...(await this.deserializeCell(header.cells, serializedNote.noteId))
            );
        }

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

        let foundInstructionsCell = false;

        // 
        for (let index = 0; index < data.cells.length; index++) {
            const cell = data.cells[index];
            let cellMetadata: NotebookCellMetadata | undefined = cell.metadata as any;

            if (cellMetadata && cellMetadata.kind === 'instructions') {
                foundInstructionsCell = true;
                continue;
            }

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
                cell.metadata = cellMetadata;
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
            deletedInstructions: !foundInstructionsCell,
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

    private convertMarkdownCellToWTNoteText (markdown: string): string {
        return markdown
            .split("\n")                                        // Split lines
            .map(line => line.trim())                           // Trim
            .filter(line => line.length > 0)                    // Filter empty lines
            .map(line => line.replace(/^-\s*/, ""))             // Remove leading '- ' that gets automatically added to markup
            .join('\n')
    }
    
    private getSerializedCell (cell: vscode.NotebookCellData, metadata: NotebookCellMetadata | undefined): SerializedCell {
        if (metadata && metadata.kind === 'instructions') throw 'unreachable';

        const convertTarget = this.getCellConvertTarget(cell);

        if (cell.kind === vscode.NotebookCellKind.Code) {
            // If the cell is not being converted into markdown, then set isEditing to true
            const isEditing: boolean = convertTarget !== 'markdown';
            return {
                editing: isEditing,
                text: cell.value
            };
        }
        else if (convertTarget === 'input') {
            // If converting from markdown into an input, then take the text value of the input
            //      from the originalText field of the metadata
            // And set editing to true
            return {
                editing: true,
                text: typeof metadata?.originalText === 'string'
                    ? metadata.originalText
                    : cell.value
            };
        }
        else {
            return {
                editing: false, 
                // metadata can possibly be null
                // If that is the case, do a quick conversion of the markdown text to wtnote text and store that as the `text` field
                text: metadata?.originalText || this.convertMarkdownCellToWTNoteText(cell.value)
            }
        }
    }

    // Reads output metadata to see if there is a target type for this cell to convert into
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

    // Reads output metadata to see if there is updated text to set this cells value to
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