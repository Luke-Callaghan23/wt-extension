import * as vscode from 'vscode';
import { Packageable } from '../packageable';
import { readNotes, readSingleNote, writeNotes, writeSingleNote } from './readWriteNotes';
import { Workspace } from '../workspace/workspaceClass';
import { Timed } from '../timedView';
import { disable, update } from './timedViewUpdate';
import { v4 as uuidv4 } from 'uuid';
import { editNote,  addNote, removeNote } from './updateNoteContents';
import { Buff } from '../Buffer/bufferSource';
import { Renamable } from '../recyclingBin/recyclingBinView';
import { TabLabels } from '../tabLabels/tabLabels';
import { compareFsPath, formatFsPathForCompare } from '../miscTools/help';
import { grepExtensionDirectory } from '../miscTools/grepExtensionDirectory';

export interface Note {
    kind: 'note';
    noteId: string;
    noun: string;
    appearance: string[];
    aliases: string[];
    description: string[];
    uri: vscode.Uri;
}

export interface AppearanceContainer {
    kind: 'appearanceContainer';
    noteId: string;
    appearances: SubNote[];
}

export interface SubNote {
    kind: 'description' | 'appearance';
    idx: number;
    noteId: string;
    description: string;
}

export interface NoteMatch {
    range: vscode.Range;
    note: Note;
}


export class WorkBible 
implements 
    vscode.TreeDataProvider<Note | SubNote | AppearanceContainer>, 
    vscode.HoverProvider, Timed, Renamable<Note>,
    vscode.ReferenceProvider
{

    readNotes = readNotes;
    readSingleNote = readSingleNote;
    writeNotes = writeNotes;
    writeSingleNote = writeSingleNote;

    addNote = addNote;
    removeNote = removeNote;
    editNote = editNote;

    enabled: boolean;
    update = update;
    disable = disable;

    static singleton: WorkBible;

    public matchedNotes: { [index: string]: NoteMatch[] };
    protected nounsRegex: RegExp | undefined;

    protected notes: Note[];
    protected workBibleFolderPath: vscode.Uri;
    public view: vscode.TreeView<Note | SubNote | AppearanceContainer>;
    constructor (
        protected workspace: Workspace,
        protected context: vscode.ExtensionContext
    ) {
        this.workBibleFolderPath = workspace.workBibleFolder;
        
        this.matchedNotes = {};

        // Will be modified by TimedView
        this.enabled = true;

        // Read notes from disk
        this.notes = []; 
        this.view = {} as vscode.TreeView<Note | SubNote | AppearanceContainer>
        this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        WorkBible.singleton = this;

        vscode.workspace.onDidSaveTextDocument(async (e: vscode.TextDocument) => {
            if (!e.fileName.endsWith('.wtnote')) return;
            if (!e.uri.fsPath.includes(this.workBibleFolderPath.fsPath)) return;

            // Read the note id from the file name and the note from the newly saved
            //      document
            const noteIdSplit = e.fileName.replace('.wtnote', '').split(/\/|\\/);
            const noteId = noteIdSplit[noteIdSplit.length - 1] || '';
            const note = this.readSingleNote(noteId, e.getText(), e.uri);

            // Find the location of the saved note in the existing notes array
            const oldNoteIdx = this.notes.findIndex(on => {
                return on.noteId === noteId;
            });

            // If the note existed in the existing array, replace it
            // Or, push the new note
            if (oldNoteIdx === -1) {
                this.notes.push(note);
            }
            else {
                this.notes[oldNoteIdx] = note;
            }

            // Refresh the treeview
            this.refresh();
        });
    }

    async renameResource (node?: Note | undefined): Promise<void> {
        if (!node) return;
        
        const originalName = node.noun;
        const newName = await vscode.window.showInputBox({
            placeHolder: originalName,
            prompt: `What would you like to rename note for '${originalName}'?`,
            ignoreFocusOut: false,
            value: originalName,
            valueSelection: [0, originalName.length]
        });
        if (!newName) return;

        node.noun = newName;
        this.writeSingleNote(node);
        return this.refresh().then(() => {
            TabLabels.assignNamesForOpenTabs();
        });
    }

    async initialize () {
        this.notes = await this.readNotes(this.workspace.worldNotesPath)
        this.nounsRegex = this.getNounsRegex();
        this.view = vscode.window.createTreeView(`wt.workBible.tree`, {
            treeDataProvider: this,
            canSelectMany: true,
            showCollapseAll: true,
        });
        vscode.languages.registerHoverProvider({
            language: 'wt',
        }, this);
        vscode.languages.registerHoverProvider({
            language: 'wtNote',
        }, this);

        vscode.languages.registerDefinitionProvider({
            language: 'wt',
        }, this);
        vscode.languages.registerDefinitionProvider({
            language: 'wtNote',
        }, this);

        vscode.languages.registerReferenceProvider({
            language: "wt",
        }, this);
        vscode.languages.registerReferenceProvider({
            language: "wtNote",
        }, this);

        this.registerCommands();
    }

    static getNewNoteId (): string {
        // Default id generated by 'uuid' cannot be used as a capture group name,
        //      so we need to map them to something usable
        const id = uuidv4();
        //@ts-ignore
        const mappedId = id.replaceAll('-', '');            // remove dashes
        return `a${mappedId}`;                              // add an 'a' to the beginning
    }

	public _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

	private _onDidChangeTreeData: vscode.EventEmitter<Note | SubNote | AppearanceContainer | undefined> = new vscode.EventEmitter<Note | SubNote | AppearanceContainer | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Note | SubNote | AppearanceContainer | undefined> = this._onDidChangeTreeData.event;
	async refresh (reload: boolean = false) {
        if (reload) {
            this.notes = await this.readNotes(this.workspace.worldNotesPath);
        }
        // Also update the nouns regex
        this.nounsRegex = this.getNounsRegex();
		this._onDidChangeTreeData.fire(undefined);
	}

    protected getNounPattern (note: Note, withId: boolean = true) {
        const realAliases = note.aliases
            .map(a => a.trim())
            .filter(a => a.length > 0);

        const aliasesAddition = realAliases.length > 0 
            ? `|${realAliases.join('|')}`
            : ``;
        const idAddition = withId
            ? `?<${note.noteId}>`
            : ``;
        return `(${idAddition}${note.noun}${aliasesAddition})`
    }

    private getNounsRegex (withId: boolean=true, withSeparator: boolean=true, subset?: Note[]): RegExp {
        if (this.notes.length === 0) {
            return /^_^/
        }
        const nounFragments = (subset || this.notes).map(note => this.getNounPattern(note, withId))
        const regexString = withSeparator 
            ? '(^|[^a-zA-Z0-9])?' + `(${nounFragments.join('|')})` + '([^a-zA-Z0-9]|$)?'
            : `(${nounFragments.join('|')})`;
        const nounsRegex = new RegExp(regexString, 'gi');
        return nounsRegex;
    }

    private registerCommands () {

        const doTheThingAndWrite = async (f: () => Promise<string | null>) => {
            const result = await f();
            if (result === null) return;
            const noteId = result;

            const note = this.notes.find(note => note.noteId === noteId);
            if (note === undefined) return;
            this.writeSingleNote(note);
        }

        vscode.commands.registerCommand("wt.workBible.addNote", (resource: Note | undefined) => { doTheThingAndWrite(() => this.addNote(resource)) });
        vscode.commands.registerCommand("wt.workBible.removeNote", (resource: Note) => { doTheThingAndWrite(() => this.removeNote(resource)) });
        vscode.commands.registerCommand('wt.workBible.search', (resource: Note) => { this.searchInSearchPanel(resource) });
        vscode.commands.registerCommand('wt.workBible.editNote', (resource: Note | AppearanceContainer | SubNote) => { this.editNote(resource) });
        vscode.commands.registerCommand('wt.workBible.getWorkBible', () => this);
        vscode.commands.registerCommand('wt.workBible.refresh', () => {
            return this.refresh(true);
        });
    }

    getTreeItem(noteNode: Note | SubNote | AppearanceContainer): vscode.TreeItem {
        const editCommand: vscode.Command = {
            command: "wt.workBible.editNote",
            title: "Edit Note",
            arguments: [ noteNode ],
        };
        switch (noteNode.kind) {
            case 'note': 
                const aliasesString = noteNode.aliases.join(', ');
                return {
                    id: noteNode.noteId,
                    contextValue: 'note',
                    label: noteNode.noun,
                    description: aliasesString,
                    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                    tooltip: aliasesString.length !== 0 
                        ? `${noteNode.noun} (${aliasesString})`
                        : `${noteNode.noun}`,
                    command: editCommand
                }
            case 'description': case 'appearance': return {
                id: `${noteNode.noteId}__${noteNode.idx}__${noteNode.kind}`,
                contextValue: noteNode.kind,
                label: noteNode.description,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                tooltip: noteNode.description,
                iconPath: new vscode.ThemeIcon("debug-breakpoint-disabled"),
                command: editCommand
            }
            case 'appearanceContainer': return {
                id: `${noteNode.noteId}__appearanceContainer`,
                contextValue: noteNode.kind,
                label: 'Appearance',
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                tooltip: 'Appearance',
                command: editCommand
            }
        }
    }
    getChildren(element?: Note | SubNote | AppearanceContainer | undefined): vscode.ProviderResult<(Note | SubNote | AppearanceContainer)[]> {
        if (!element) return this.notes;
        switch (element.kind) {
            case 'note': 
                const descriptions: SubNote[] = element.description.map((desc, idx) => ({
                    kind: 'description',
                    idx: idx,
                    noteId: element.noteId,
                    description: desc,
                }));

                const appearances: SubNote[] = element.appearance.map((desc, idx) => ({
                    kind: 'appearance',
                    description: desc,
                    idx: idx,
                    noteId: element.noteId
                }));

                const appearanceContainer: AppearanceContainer = {
                    appearances: appearances,
                    kind: 'appearanceContainer',
                    noteId: element.noteId
                }

                return [
                    appearanceContainer,
                    ...descriptions
                ];
            case 'appearanceContainer': 
                return element.appearances
            case 'description': case 'appearance':
                return [];
        }
    }

    getParent(element: Note | SubNote | AppearanceContainer): vscode.ProviderResult<Note | SubNote | AppearanceContainer> {
        if (element.kind === 'description' || element.kind === 'appearance' || element.kind === 'appearanceContainer') {
            return this.notes.find(note => note.noteId === element.noteId);
        }
        else if (element.kind === 'note') {
            return null;
        }
        else throw `Not possible`;
    }

    getNote (noteUri: vscode.Uri): Note | null {
        return this.notes.find(note => {
            return compareFsPath(note.uri, noteUri);
        }) || null;
    }

    async searchInSearchPanel (resource: Note) {
        vscode.commands.executeCommand('workbench.action.findInFiles', {
            query: this.getNounPattern(resource, false),
            triggerSearch: true,
            filesToInclude: 'data/chapters/**, data/snips/**',
            isRegex: true,
            isCaseSensitive: false,
            matchWholeWord: true,
        });
    }


    provideHover(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        if (!this.matchedNotes) return null;

        const documentMatches = this.matchedNotes[formatFsPathForCompare(document.uri)];
        if (!documentMatches) return null;

        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;
        if (this.view.visible) {
            this.view.reveal(matchedNote.note, {
                select: true,
                expand: true,
            });
        }
        return null;
    }

    provideDefinition (
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if (!this.matchedNotes) return null;

        const documentMatches = this.matchedNotes[formatFsPathForCompare(document.uri)];
        if (!documentMatches) return null;

        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;
    
        if (this.view.visible) {
            this.view.reveal(matchedNote.note, {
                select: true,
                expand: true,
            });
        }
    
        const fileName = `${matchedNote.note.noteId}.wtnote`;
        const filePath = vscode.Uri.joinPath(this.workBibleFolderPath, fileName);
        return <vscode.Definition>{
            uri: filePath,
            range: new vscode.Range(position, position),
        };
    }

    async provideReferences(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        context: vscode.ReferenceContext, 
        token: vscode.CancellationToken
    ): Promise<vscode.Location[] | null> {
        if (!this.matchedNotes) return null;

        const documentMatches = this.matchedNotes[formatFsPathForCompare(document.uri)];
        if (!documentMatches) return null;

        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;
    
        const subsetNounsRegex = this.getNounsRegex(false, false, [ matchedNote.note ]);
        const grepLocations: vscode.Location[] = []; 
        for await (const loc of grepExtensionDirectory(subsetNounsRegex.source, true, true, true)) {
            if (loc === null) return null;
            grepLocations.push(loc);
        }

        // For some reason the reference provider needs the locations to be indexed one less than the results from the 
        //      grep of the nouns
        // Not sure why that is -- but subtracting one from each character index works here
        return grepLocations.map(loc => new vscode.Location(loc.uri, new vscode.Range(
            new vscode.Position(loc.range.start.line, Math.max(loc.range.start.character - 1, 0)),
            new vscode.Position(loc.range.end.line, Math.max(loc.range.end.character - 1, 0))
        )));
    }
}