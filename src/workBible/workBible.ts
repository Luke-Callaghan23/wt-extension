import * as vscode from 'vscode';
import { Packageable } from '../packageable';
import { readNotes, readSingleNote, writeNotes, writeSingleNote } from './fs';
import { Workspace } from '../workspace/workspaceClass';
import { addAlias, addSubNote, addNote, removeAlias, removeSubNote, removeNote, addAppearance } from './update';
import { Timed } from '../timedView';
import { disable, update } from './timer';
import { v4 as uuidv4 } from 'uuid';
import { provideHover } from './hoverProvider';
import { searchNote } from './search';
import { provideDefinition } from './definitionLink';
import { editNote } from './editNote';

export interface Note {
    kind: 'note';
    noteId: string;
    noun: string;
    appearance: string[];
    aliases: string[];
    description: string[];
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
export interface UriNoteMatch {
    docUri: vscode.Uri,
    matches: NoteMatch[]
}

export class WorkBible 
implements 
    vscode.TreeDataProvider<Note | SubNote | AppearanceContainer>, 
    vscode.HoverProvider,
    Packageable, Timed 
{

    readNotes = readNotes;
    readSingleNote = readSingleNote;
    writeNotes = writeNotes;
    writeSingleNote = writeSingleNote;

    addAlias = addAlias;
    removeAlias = removeAlias;
    addNote = addNote;
    removeNote = removeNote;
    addSubNote = addSubNote;
    removeSubNote = removeSubNote;
    addAppearance = addAppearance;

    searchNote = searchNote;
    editNote = editNote;

    provideHover = provideHover;

    provideDefinition = provideDefinition;
    
    enabled: boolean;
    update = update;
    disable = disable;

    static singleton: WorkBible;

    public matchedNotes: UriNoteMatch | undefined;
    protected nounsRegex: RegExp | undefined;

    protected notes: Note[];
    protected dontAskDeleteNote: boolean;
    protected dontAskDeleteDescription: boolean;
    protected dontAskDeleteAppearance: boolean;
    protected workBibleFolderPath: vscode.Uri;
    protected view: vscode.TreeView<Note | SubNote | AppearanceContainer>;
    constructor (
        protected workspace: Workspace,
        protected context: vscode.ExtensionContext
    ) {
        this.workBibleFolderPath = workspace.workBibleFolder;
        
        const dontAskDeleteNote: boolean | undefined = context.globalState.get<boolean>('wt.workBible.dontAskDeleteNote');
        this.dontAskDeleteNote = dontAskDeleteNote || false;
        
        const dontAskDeleteDescription: boolean | undefined = context.globalState.get<boolean>('wt.workBible.dontAskDeleteDescription');
        this.dontAskDeleteDescription = dontAskDeleteDescription || false;

        const dontAskDeleteAppearance: boolean | undefined = context.globalState.get<boolean>('wt.workBible.dontAskDeleteAppearance');
        this.dontAskDeleteAppearance = dontAskDeleteAppearance || false;

        // Will be modified by TimedView
        this.enabled = true;

        // Read notes from disk
        this.notes = []; 
        this.view = {} as vscode.TreeView<Note | SubNote | AppearanceContainer>
        this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        (async () => { 
            this.notes = await this.readNotes(workspace.worldNotesPath)
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

            this.registerCommands();
        })();
        WorkBible.singleton = this;

        vscode.workspace.onDidSaveTextDocument(async (e: vscode.TextDocument) => {
            if (!e.fileName.endsWith('.wtnote')) return;
            if (!e.uri.fsPath.includes(this.workBibleFolderPath.fsPath)) return;

            // Read the note id from the file name and the note from the newly saved
            //      document
            const noteIdSplit = e.fileName.replace('.wtnote', '').split(/\/|\\/);
            const noteId = noteIdSplit[noteIdSplit.length - 1] || '';
            const note = this.readSingleNote(noteId, e.getText());

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
	refresh () {
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

    private getNounsRegex (): RegExp {
        if (this.notes.length === 0) {
            return /^_^/
        }
        const nounFragments = this.notes.map(note => this.getNounPattern(note))
        const regexString = '[^a-zA-Z0-9]' + `(${nounFragments.join('|')})` + '[^a-zA-Z0-9]';
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

        vscode.commands.registerCommand("wt.workBible.addAlias", (resource: Note) => { doTheThingAndWrite(() => this.addAlias(resource)) });
        vscode.commands.registerCommand("wt.workBible.removeAlias", (resource: Note) => { doTheThingAndWrite(() => this.removeAlias(resource)) });
        vscode.commands.registerCommand("wt.workBible.addNote", (resource: Note | undefined) => { doTheThingAndWrite(() => this.addNote(resource)) });
        vscode.commands.registerCommand("wt.workBible.removeNote", (resource: Note) => { doTheThingAndWrite(() => this.removeNote(resource)) });
        vscode.commands.registerCommand("wt.workBible.addSubNote", (resource: SubNote) => { doTheThingAndWrite(() => this.addSubNote(resource)) });
        vscode.commands.registerCommand("wt.workBible.removeSubNote", (resource: SubNote) => { doTheThingAndWrite(() => this.removeSubNote(resource)) });
        vscode.commands.registerCommand("wt.workBible.addAppearance", (resource: AppearanceContainer) => { doTheThingAndWrite(() => this.addAppearance(resource)) });
        vscode.commands.registerCommand('wt.workBible.search', (resource: Note) => { this.searchNote(resource) });
        vscode.commands.registerCommand('wt.workBible.editNote', (resource: Note | AppearanceContainer | SubNote) => { this.editNote(resource) });
    }

    getPackageItems(): { [index: string]: any; } {
        return {
            'wt.workBible.dontAskDeleteNote': this.dontAskDeleteNote,
            'wt.workBible.dontAskDeleteDescription': this.dontAskDeleteDescription,
            'wt.workBible.dontAskDeleteAppearance': this.dontAskDeleteAppearance
        };
    }


    getTreeItem(noteNode: Note | SubNote | AppearanceContainer): vscode.TreeItem | Thenable<vscode.TreeItem> {
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
                }
            case 'description': case 'appearance': return {
                id: `${noteNode.noteId}__${noteNode.idx}__${noteNode.kind}`,
                contextValue: noteNode.kind,
                label: noteNode.description,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                tooltip: noteNode.description,
                iconPath: new vscode.ThemeIcon("debug-breakpoint-disabled")
            }
            case 'appearanceContainer': return {
                id: `${noteNode.noteId}__appearanceContainer`,
                contextValue: noteNode.kind,
                label: 'Appearance',
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                tooltip: 'Appearance',
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
}