import * as vscode from 'vscode';
import { Packageable } from '../packageable';
import { Workspace } from '../workspace/workspaceClass';
import { Timed } from '../timedView';
import { disable, update, notebookDecorations, getNoteMatchesInText } from './timedViewUpdate';
import { v4 as uuidv4 } from 'uuid';
import { editNote,  addNote, removeNote } from './updateNoteContents';
import { Buff } from '../Buffer/bufferSource';
import { Renamable } from '../recyclingBin/recyclingBinView';
import { TabLabels } from '../tabLabels/tabLabels';
import { _, compareFsPath, defaultProgress, formatFsPathForCompare, getTextCapitalization, readDotConfig, transformToCapitalization, writeDotConfig } from '../miscTools/help';
import { grepExtensionDirectory } from '../miscTools/grepExtensionDirectory';
import { WTNotebookSerializer } from './notebookApi/notebookSerializer';
import { capitalize } from '../miscTools/help';
import { ExtensionGlobals } from '../extension';


export interface NotebookPanelNote {
    kind: 'note';
    noteId: string;
    title: string;
    aliases: string[];
    sections: NoteSection[];
    uri: vscode.Uri;
}

export interface NoteSection {
    kind: 'section';
    noteId: string,
    header: string;
    idx: number,
    bullets: BulletPoint[];
}

export interface BulletPoint {
    kind: 'bullet';
    noteId: string;
    sectionIdx: number;
    idx: number;
    text: string;
    subBullets?: BulletPoint[];
}

export interface NoteMatch {
    range: vscode.Range;
    note: NotebookPanelNote;
}

export class NotebookPanel 
implements 
    vscode.TreeDataProvider<NotebookPanelNote | NoteSection | BulletPoint>, 
    vscode.HoverProvider, Timed, Renamable<NotebookPanelNote>,
    vscode.ReferenceProvider,
    vscode.RenameProvider,
    vscode.DocumentLinkProvider
{
    addNote = addNote;
    removeNote = removeNote;
    editNote = editNote;

    enabled: boolean;
    update = update;
    getNoteMatchesInText = getNoteMatchesInText;
    disable = disable;

    static singleton: NotebookPanel;

    public matchedNotebook: { [index: string]: NoteMatch[] };
    public nounsRegex: RegExp | undefined;

    public notebook: NotebookPanelNote[];
    protected notebookFolderPath: vscode.Uri;
    public view: vscode.TreeView<NotebookPanelNote | NoteSection | BulletPoint>;
    constructor (
        public workspace: Workspace,
        public context: vscode.ExtensionContext,
        protected serializer: WTNotebookSerializer
    ) {
        this.notebookFolderPath = workspace.notebookFolder;
        
        this.matchedNotebook = {};

        // Will be modified by TimedView
        this.enabled = true;

        // Read notebook from disk
        this.notebook = []; 
        this.view = {} as vscode.TreeView<NotebookPanelNote | NoteSection | BulletPoint>
        this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        NotebookPanel.singleton = this;

        this.context.subscriptions.push(notebookDecorations);
    }

    async renameResource (node?: NotebookPanelNote | undefined): Promise<void> {
        if (!node) return;
        
        const originalName = node.title;
        const newName = await vscode.window.showInputBox({
            placeHolder: originalName,
            prompt: `What would you like to rename note for '${originalName}'?`,
            ignoreFocusOut: false,
            value: originalName,
            valueSelection: [0, originalName.length]
        });
        if (!newName) return;

        node.title = newName;
        this.serializer.writeSingleNote(node);
        return this.refresh().then(() => {
            TabLabels.assignNamesForOpenTabs();
        });
    }

    async initialize () {
        this.notebook = await this.serializer.deserializeNotebookPanel(this.notebookFolderPath);
        this.nounsRegex = this.getNounsRegex();
        this.view = vscode.window.createTreeView(`wt.notebook.tree`, {
            treeDataProvider: this,
            canSelectMany: true,
            showCollapseAll: true,
        });
        this.context.subscriptions.push(this.view);
        this.context.subscriptions.push(vscode.languages.registerHoverProvider({
            language: 'wt',
        }, this));
        this.context.subscriptions.push(vscode.languages.registerHoverProvider({
            language: 'wtNote',
        }, this));

        this.context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({
            language: 'wt',
        }, this));
        this.context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({
            language: 'wtNote',
        }, this));

        this.context.subscriptions.push(vscode.languages.registerReferenceProvider({
            language: "wt",
        }, this));
        this.context.subscriptions.push(vscode.languages.registerReferenceProvider({
            language: "wtNote",
        }, this));

        this.context.subscriptions.push(vscode.languages.registerRenameProvider({
            language: "wt",
        }, this));
        this.context.subscriptions.push(vscode.languages.registerRenameProvider({
            language: "wtNote",
        }, this));

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

	private _onDidChangeTreeData: vscode.EventEmitter<NotebookPanelNote | NoteSection | BulletPoint | undefined> = new vscode.EventEmitter<NotebookPanelNote | NoteSection | BulletPoint | undefined>();
	readonly onDidChangeTreeData: vscode.Event<NotebookPanelNote | NoteSection | BulletPoint | undefined> = this._onDidChangeTreeData.event;
	async refresh (reload: boolean = false) {
        if (reload) {
            this.notebook = await this.serializer.deserializeNotebookPanel(this.notebookFolderPath);
        }
        // Also update the nouns regex
        this.nounsRegex = this.getNounsRegex();
		this._onDidChangeTreeData.fire(undefined);
	}

    protected getNounPattern (note: NotebookPanelNote, withId: boolean = true) {
        const realAliases = note.aliases
            .map(a => a.trim())
            .filter(a => a.length > 0);

        const aliasesAddition = realAliases.length > 0 
            ? `|${realAliases.join('|')}`
            : ``;
        const idAddition = withId
            ? `?<${note.noteId}>`
            : ``;
        return `(${idAddition}${note.title}${aliasesAddition})`
    }

    private getNounsRegex (
        withId: boolean=true, 
        withSeparator: boolean=true, 
        subset?: NotebookPanelNote[],
    ): RegExp {
        if (this.notebook.length === 0) {
            return /^_^/
        }
        const nounFragments = (subset || this.notebook).map(note => this.getNounPattern(note, withId))
        const regexString = withSeparator 
            ? '(^|[^a-zA-Z0-9])' + `(${nounFragments.join('|')})` + '([^a-zA-Z0-9]|$)'
            : `(${nounFragments.join('|')})`;
        const nounsRegex = new RegExp(regexString, 'gi');
        return nounsRegex;
    }

    private registerCommands () {

        const doTheThingAndWrite = async (f: () => Promise<string | null>) => {
            const result = await f();
            if (result === null) return;
            const noteId = result;

            const note = this.notebook.find(note => note.noteId === noteId);
            if (note === undefined) return;
            this.serializer.writeSingleNote(note);
        }
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.addNote", (resource: NotebookPanelNote | undefined) => { doTheThingAndWrite(() => this.addNote(resource)) }));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.removeNote", (resource: NotebookPanelNote) => { doTheThingAndWrite(() => this.removeNote(resource)) }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.search', (resource: NotebookPanelNote) => { this.searchInSearchPanel(resource) }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.editNote', (resource: NotebookPanelNote | NoteSection | BulletPoint) => { this.editNote(resource) }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.getNotebook', () => this));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.refresh', () => {
            return this.refresh(true);
        }));
    }

    getTreeItem(noteNode: NotebookPanelNote | NoteSection | BulletPoint): vscode.TreeItem {
        const editCommand: vscode.Command = {
            command: "wt.notebook.editNote",
            title: "Edit Note",
            arguments: [ noteNode ],
        };
        switch (noteNode.kind) {
            case 'note': 
                const aliasesString = noteNode.aliases.join(', ');
                return {
                    id: noteNode.noteId,
                    contextValue: 'note',
                    label: noteNode.title,
                    description: aliasesString,
                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                    tooltip: aliasesString.length !== 0 
                        ? `${noteNode.title} (${aliasesString})`
                        : `${noteNode.title}`,
                    command: editCommand
                }
            case 'bullet': return {
                id: `${noteNode.noteId}__${noteNode.sectionIdx}__${noteNode.kind}__${noteNode.idx}__${Math.random()}`,
                contextValue: noteNode.kind,
                label: noteNode.text,
                collapsibleState: noteNode.subBullets && noteNode.subBullets.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                tooltip: noteNode.text,
                iconPath: new vscode.ThemeIcon("debug-breakpoint-disabled"),
                command: editCommand
            }
            case 'section': return {
                id: `${noteNode.noteId}__section__${noteNode.idx}`,
                contextValue: noteNode.kind,
                label: capitalize(noteNode.header),
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                tooltip: capitalize(noteNode.header),
                command: editCommand
            }
        }
    }
    getChildren(element?: NotebookPanelNote | NoteSection | BulletPoint | undefined): vscode.ProviderResult<(NotebookPanelNote | NoteSection | BulletPoint)[]> {
        if (!element) return this.notebook;
        switch (element.kind) {
            case 'note': 
                return element.sections;
            case 'section': 
                return element.bullets;
            case 'bullet':
                return element.subBullets || [];
        }
    }

    getParent(element: NotebookPanelNote | NoteSection | BulletPoint): vscode.ProviderResult<NotebookPanelNote | NoteSection | BulletPoint> {
        if (element.kind === 'note') {
            return null;
        }
        return this.notebook.find(note => note.noteId === element.noteId);
    }

    getNote (noteUri: vscode.Uri): NotebookPanelNote | null {
        return this.notebook.find(note => {
            const thisUri = note.uri;
            return compareFsPath(thisUri, noteUri);
        }) || null;
    }

    async searchInSearchPanel (resource: NotebookPanelNote) {
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
        if (!this.matchedNotebook) return null;

        const documentMatches = this.matchedNotebook[formatFsPathForCompare(document.uri)];
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
    
    async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[] | null> {
        if (!this.matchedNotebook) return null;

        const documentMatches = this.matchedNotebook[formatFsPathForCompare(document.uri)];
        if (!documentMatches) return null;

        const documentLinks: vscode.DocumentLink[] = [];
        for (const match of documentMatches) {
            const matchedNote = match.note;
        
            if (this.view.visible) {
                this.view.reveal(matchedNote, {
                    select: true,
                    expand: true,
                });
            }
        
            const fileName = `${matchedNote.noteId}.wtnote`;
            const filePath = vscode.Uri.joinPath(this.notebookFolderPath, fileName);
            documentLinks.push({
                target: filePath,
                range: match.range,
            });
        }
        return documentLinks;
    }

    async provideReferences(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        context: vscode.ReferenceContext, 
        token: vscode.CancellationToken
    ): Promise<vscode.Location[] | null> {
        if (!this.matchedNotebook) return null;
        
        const documentMatches = this.matchedNotebook[formatFsPathForCompare(document.uri)];
        if (!documentMatches) return null;

        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;

        return defaultProgress(`Collecting references for '${matchedNote.note.title}'`, async () => {
            const subsetNounsRegex = this.getNounsRegex(false, false, [ matchedNote.note ]);
            const grepLocations: vscode.Location[] = []; 
            for await (const loc of grepExtensionDirectory(subsetNounsRegex.source, true, true, true)) {
                if (loc === null) return null;
                grepLocations.push(loc[0]);
            }
    
            // For some reason the reference provider needs the locations to be indexed one less than the results from the 
            //      grep of the nouns
            // Not sure why that is -- but subtracting one from each character index works here
            return grepLocations;
        });
    }

    
    async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit | null> {
        if (!this.matchedNotebook) return null;

        const documentMatches = this.matchedNotebook[formatFsPathForCompare(document.uri)];
        if (!documentMatches) return null;

        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;

        const aliasText = document.getText(matchedNote.range);
        const edits = this.getRenameEditsForNote(matchedNote.note, aliasText, newName);
        
        // `onDidRenameFiles` will be called after the edits are applied.  When that happens, we want to reload
        setTimeout(() => {
            vscode.commands.executeCommand("wt.reloadWatcher.reloadViews");
            vscode.window.showInformationMessage("Finished updating.  If you see some inaccuracies in a wtnote notebook window please just close and re-open.")
        }, 2000);

        return edits;
    }

    async getRenameEditsForNote (notePanelNote: NotebookPanelNote, aliasText: string, newName: string): Promise<vscode.WorkspaceEdit | null> {
        const aliasRegexString = `(${aliasText})`;
        const aliasRegex = new RegExp(aliasRegexString, 'gi');
        
        const locations: [ vscode.Location, string ][] | null= await defaultProgress(`Collecting references for '${notePanelNote.title}'`, async () => {
            const grepLocations: [ vscode.Location, string ][] = []; 
            for await (const loc of grepExtensionDirectory(aliasRegexString, true, true, true)) {
                if (loc === null) return null;
                grepLocations.push(loc);
            }
    
            // For some reason the reference provider needs the locations to be indexed one less than the results from the 
            //      grep of the nouns
            // Not sure why that is -- but subtracting one from each character index works here
            return grepLocations.map(([loc, match]) => [ 
                loc, 
                match 
            ]);
        });
        if (!locations) return null;

        while (true) {
            const resp = await vscode.window.showInformationMessage(`Are you sure you want to replace ${locations.length} instances of '${aliasText}'?`, {
                detail: `
WARNING: this is kinda dangerous.
• This will replace '${aliasText}' to '${newName}' in all possible locations, including: titles, wtnote notebooks, and fragment text files.  
• This can be undone... probably.  I don't trust VSCode enough to promise you that ctrl+z will do exactly as you expect, but it has worked in my experience.  I still recommend you do a git commit first.
• Also I'll try my best to match all the capitalizations for all replacements but, really, really, no promises.
• Also, this will only replace exact matches to the original text '${aliasText}'.  No near matches or misspellings.  (Threat Level Midnight, The Office, etc., etc.)
• Basically, I don't really recommend you doing this unless you're planning on reading through your whole project again and manually fixing anything this might break.
                `,
                modal: true,
            }, "Yes I'm sure", 'Show me the clip from The Office');
            if (resp === 'Show me the clip from The Office') {
                await vscode.env.openExternal(vscode.Uri.parse(
                    "https://youtu.be/-FoKU54ITuI?si=AARaG7AjkqqQw4I0&t=110"
                ));
                continue;
            }
            if (resp !== "Yes I'm sure") return null;
            break;
        }

        const replacedUris: Set<string> = new Set<string>();

        const edits = await defaultProgress(`Collecting edits for '${notePanelNote.title}'`, async () => {
            const edits = new vscode.WorkspaceEdit();
            for (const [ location, matchedText ] of locations) {

                // Copy the capitalization format from aliasText over to newName, 
                const docMatchedText = matchedText.substring(matchedText.indexOf(aliasText), aliasText.length);
                const capialization = getTextCapitalization(docMatchedText);
                const correctedCapitalization = transformToCapitalization(newName, capialization);

                if (location.uri.fsPath.endsWith('.wt')) {
                    edits.replace(location.uri, location.range, correctedCapitalization);
                }
                else if (location.uri.fsPath.endsWith('.wtnote')) {
                    // Edits to notes are done in one go, because it is difficult to track exact replacements otherwise
                    if (replacedUris.has(location.uri.fsPath)) {
                        continue;
                    }

                    const note = await vscode.workspace.fs.readFile(location.uri).then(buffer => {
                        return this.serializer.readSerializedNote(buffer);
                    });

                    // Find and replace inside of all the bullet points of this note
                    for (const [ _, section ] of Object.entries(note.headers)) {
                        const repl = section.cells.map(bullet => ({
                            ...bullet,
                            text: bullet.text.replaceAll(
                                aliasRegex, 
                                // Pass in replacement function that replaces only `aliasText`
                                //      with correctedCapitalization
                                // This is because the alias regex adds spaces to ensure that it
                                //      is matching a whole word, but we do not want those
                                //      spaces being replaced in the final string
                                rep => rep.replace(aliasRegex, correctedCapitalization)
                            )
                        }));
                        section.cells = repl;
                    }
                    note.title.text = note.title.text.replaceAll(aliasRegex, rep => rep.replace(aliasRegex, correctedCapitalization));
                    const updatedSerializedNote = note;

                    // Create an edit to overwrite the whole file with the new replaced contents
                    edits.createFile(location.uri, {
                        overwrite: true,
                        contents: Buff.from(JSON.stringify(updatedSerializedNote, undefined, 4))
                    });

                    // Since serializer.findAndReplace covers all replacements for the whole wtnote document
                    //      and we don't want to waste time performing the same replacements over and over
                    //      again, we add this uri to the set of modified notes so that if we encounter
                    //      this again we can just skip it
                    replacedUris.add(location.uri.fsPath);
                }
                else if (location.uri.fsPath.endsWith('.config')) {
                    const config = await readDotConfig(location.uri);
                    if (!config) continue;
                    
                    // See notes above for replacing the inner text of the alias match
                    for (const [ _, entry ] of Object.entries(config)) {
                        entry.title = entry.title.replaceAll(aliasRegex, rep => rep.replace(aliasRegex, correctedCapitalization));
                    }

                    // See notes above about overwriting files
                    edits.createFile(location.uri, {
                        overwrite: true,
                        contents: Buff.from(JSON.stringify(config, undefined))
                    });
                    replacedUris.add(location.uri.fsPath);
                }
                else continue;
            }
            return edits;
        });
        return edits;
    }

    prepareRename (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Range> {
        if (!this.matchedNotebook) return null;
        const documentMatches = this.matchedNotebook[formatFsPathForCompare(document.uri)];
        if (!documentMatches) return null;
        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;
        return matchedNote.range;
    }    
}