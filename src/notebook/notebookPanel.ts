import * as vscode from 'vscode';
import { Packageable } from '../packageable';
import { Workspace } from '../workspace/workspaceClass';
import { Timed, TimedView } from '../timedView';
import { disable, update, notebookDecorations, getNoteMatchesInText } from './timedViewUpdate';
import { v4 as uuidv4 } from 'uuid';
import { editNote,  addNote, removeNote } from './updateNoteContents';
import { Buff } from '../Buffer/bufferSource';
import { Renamable } from '../recyclingBin/recyclingBinView';
import { TabLabels } from '../tabLabels/tabLabels';
import { __, addSingleWorkspaceEdit, compareFsPath, defaultProgress, formatFsPathForCompare, getFullJSONStringFromLocation, getTextCapitalization, readDotConfig, transformToCapitalization, writeDotConfig } from '../miscTools/help';
import { grepExtensionDirectory } from '../miscTools/grepper/grepExtensionDirectory';
import { WTNotebookSerializer } from './notebookApi/notebookSerializer';
import { capitalize } from '../miscTools/help';
import { ExtensionGlobals } from '../extension';


export interface NotebookPanelNote {
    kind: 'note';
    noteId: string;
    title: string;
    aliases: string[];
    sections: NoteSection[];
    deletedInstructions: boolean;
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

    public matchedNotebook: Record<string, NoteMatch[]>;
    public titlesAndAliasesRegex: RegExp | undefined;

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
        this.titlesAndAliasesRegex = this.getTitlesAndAliasesRegex();
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
        // Also update the titles and aliases regex
        this.titlesAndAliasesRegex = this.getTitlesAndAliasesRegex();
		this._onDidChangeTreeData.fire(undefined);
	}

    protected getTitleAndAliasPattern (note: NotebookPanelNote, withId: boolean = true) {
        const realAliases = [...note.aliases, note.title]
            .map(a => a.trim())
            .filter(a => a.length > 0)
            .sort((a, b) => b.length - a.length);

        const aliasesAddition = realAliases.length > 0 
            ? `${realAliases.join('|')}`
            : ``;
        const idAddition = withId
            ? `?<${note.noteId}>`
            : ``;
        return `(${idAddition}${aliasesAddition})`
    }

    private getTitlesAndAliasesRegex (
        withId: boolean=true, 
        withSeparator: boolean=true, 
        subset?: NotebookPanelNote[],
    ): RegExp {
        if (this.notebook.length === 0) {
            return /^_^/
        }
        const titleAndAliasFragments = (subset || this.notebook).map(note => this.getTitleAndAliasPattern(note, withId))
        const regexString = withSeparator 
            ? '(^|[^a-zA-Z0-9])' + `(${titleAndAliasFragments.join('|')})` + '([^a-zA-Z0-9]|$)'
            : `(${titleAndAliasFragments.join('|')})`;
        return new RegExp(regexString, 'gi');
    }

    private registerCommands () {

        const doTheThingAndWrite = async (f: () => Promise<string | null>) => {
            const result = await f();
            if (result === null) return;
            const noteId = result;

            const note = this.notebook.find(note => note.noteId === noteId);
            if (note === undefined) return;
            await this.serializer.writeSingleNote(note);
            await this.refresh(true);
            return vscode.commands.executeCommand('wt.timedViews.update');
        }
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.addNote", (resource: NotebookPanelNote | string | undefined) => { doTheThingAndWrite(() => this.addNote(resource)) }));
        this.context.subscriptions.push(vscode.commands.registerCommand("wt.notebook.removeNote", (resource: NotebookPanelNote) => { doTheThingAndWrite(() => this.removeNote(resource)) }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.search', (resource: NotebookPanelNote) => { this.searchInSearchPanel(resource) }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.editNote', (resource: NotebookPanelNote | NoteSection | BulletPoint) => { this.editNote(resource) }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.getNotebook', () => this));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.refresh', () => {
            return this.refresh(true);
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.notebook.addAliasToNote', async (alias: string) => {
            type NoteSelect = vscode.QuickPickItem & { note: NotebookPanelNote }

            const noteSelect = await vscode.window.showQuickPick<NoteSelect>(this.notebook.map(notebookNote => __<NoteSelect>({
                label: notebookNote.title,
                description: `(${notebookNote.aliases.join(", ")})`,
                alwaysShow: true,
                note: notebookNote,
            })));
            if (!noteSelect) return;

            const note = noteSelect.note;
            return doTheThingAndWrite(async () => {
                note.aliases.push(alias);
                return note.noteId;
            });
        }))
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
            query: this.getTitleAndAliasPattern(resource, false),
            triggerSearch: true,
            filesToInclude: 'data/chapters/**, data/snips/**',
            isRegex: true,
            isCaseSensitive: false,
            matchWholeWord: true,
        });
    }

    async forceUpdate () {
        if (vscode.window.activeTextEditor) {
            return this.update(vscode.window.activeTextEditor);
        }
    }

    async getDocumentMatch (document: vscode.TextDocument): Promise<NoteMatch[] | null> {
        if (!this.matchedNotebook) {
            await this.forceUpdate();
        }
        if (!this.matchedNotebook) return null;

        const documentMatches = this.matchedNotebook[formatFsPathForCompare(document.uri)];
        if (!documentMatches) {
            await this.forceUpdate();
            return this.matchedNotebook[formatFsPathForCompare(document.uri)] || null;
        }
        else {
            return documentMatches;
        }
    }

    async provideHover(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const documentMatches = await this.getDocumentMatch(document);
        if (!documentMatches) return null;

        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;
        if (this.view.visible) {
            this.view.reveal(matchedNote.note, {
                select: true,
                expand: true,
            }).then(()=>{}, error => {});
        }
        return null;
    }
    
    getMarkdownForNote (note: NotebookPanelNote): string {
        const aliasesString = note.aliases.join(', ');
        const title = `## ${note.title}`;
        const subtitle = aliasesString.length !== 0
            ? `#### (*${aliasesString}*)\n`
            : '';

        const descriptions = note.sections
            .filter(section => section.header.toLocaleLowerCase() !== 'aliases' && section.header.toLocaleLowerCase() !== 'alias')
            .map(section => `- ${capitalize(section.header)}\n` + (
                section.bullets.map(
                    bullet => `  - ${bullet.text}`
                ).join('\n')
            ))
            .join('\n');

        return `${title}\n${subtitle}\n${descriptions}`;
    }

    async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[] | null> {
        const documentMatches = await this.getDocumentMatch(document);
        if (!documentMatches) return null;

        const documentLinks: vscode.DocumentLink[] = [];
        for (const match of documentMatches) {
            const matchedNote = match.note;
        
            if (this.view.visible) {
                this.view.reveal(matchedNote, {
                    select: true,
                    expand: true,
                }).then(()=>{}, error => {});
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
        const documentMatches = await this.getDocumentMatch(document);
        if (!documentMatches) return null;

        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;

        return defaultProgress(`Collecting references for '${matchedNote.note.title}'`, async () => {
            const subsetTitlesAndAliasesRegex = this.getTitlesAndAliasesRegex(false, false, [ matchedNote.note ]);

            try {
                const results = await grepExtensionDirectory(subsetTitlesAndAliasesRegex.source, true, true, true, token);
                return !results ? null : results.map(([ loc, _ ]) => loc);
            }
            catch (err: any) {
                vscode.window.showErrorMessage(`[ERR] An error occurred while searching for references: ${err}`);
                return null;
            }
        });
    }

    
    async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit | null> {
        const documentMatches = await this.getDocumentMatch(document);
        if (!documentMatches) return null;

        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;

        const aliasText = document.getText(matchedNote.range);
        const edits = this.getRenameEditsForNote(matchedNote.note, aliasText, newName, token);
        
        // `onDidRenameFiles` will be called after the edits are applied.  When that happens, we want to reload
        setTimeout(() => {
            vscode.commands.executeCommand("wt.reloadWatcher.reloadViews");
            vscode.window.showInformationMessage("Finished updating.  If you see some inaccuracies in a wtnote notebook window please just close and re-open.")
        }, 3000);

        return edits;
    }

    async getRenameEditsForNote (notePanelNote: NotebookPanelNote, aliasText: string, newName: string, cancellationToken: vscode.CancellationToken): Promise<vscode.WorkspaceEdit | null> {
        const aliasRegexString = `(${aliasText})`;
        const aliasRegex = new RegExp(aliasRegexString, 'gi');
        
        const locations: [ vscode.Location, string ][] | null= await defaultProgress(`Collecting references for '${notePanelNote.title}'`, async () => {
            return grepExtensionDirectory(aliasRegexString, true, true, true, cancellationToken); 
        });
        if (!locations) return null;

        while (true) {
            const resp = await vscode.window.showInformationMessage(`Are you sure you want to replace ${locations.length} instances of '${aliasText}'?`, {
                detail: `
WARNING: this is kinda dangerous.
• This will replace '${aliasText}' to '${newName}' in all possible locations, including: titles, wtnote Notebooks, and fragment text files.  
• This can be undone... kinda.  
    • If you want to undo with ctrl+z, I would recommend all notebook documents being CLOSED, because VSCode does not currently re-render Notebook documents after a refactor like this, and if you undo, then save non-re-serialized document you're going to mess something up.  
    • After the undo is finished, MAKE SURE to run "Writing Tool: Refresh Workspace" (wt.reloadWatcher.reloadWorkspace) from your comand palette for those changes to be reflected in your workspace
    • For best results, just don't ctrl+z undo.  You can either undo this rename by running the rename again with the original word -- which will probably avoid all the issue listed above.
    • Or, even better, make a git commit before doing this, then revert to that commit if you mess something up
• Also the replaced to match all the capitalizations for all replacements but no promises.
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

        const resp = await vscode.window.showInformationMessage(`Copy case of source or destination?`, {
            detail: `
When replacing values of '${aliasText}' with '${newName}' would you to copy the capitalization of the '${newName}' exaclty as you entered it, or attempt to to copy the case of each location that is being over written?
For example if you wrote all caps '${aliasText.toLocaleUpperCase()}' somewhere in your project would you like WTANIWE to overwrite that with '${newName.toUpperCase()}'
Or to always use '${newName}' exactly as you entered it?
            `,
            modal: true,
        }, "Attempt to match the case", 'Exactly as I entered it');
        if (!resp) return null;

        const copyingDestinationCase = resp === 'Attempt to match the case';

        const edits = await defaultProgress(`Collecting edits for '${notePanelNote.title}'`, async () => {
            const edits = new vscode.WorkspaceEdit();
            for (const [ location, matchedText ] of locations) {

                let replacementString: string;
                if (copyingDestinationCase) {
                    // Copy the capitalization format from aliasText over to newName, 
                    const docMatchedText = matchedText.substring(matchedText.indexOf(aliasText), aliasText.length);
                    const capialization = getTextCapitalization(docMatchedText);
                    const correctedCapitalization = transformToCapitalization(newName, capialization);
                    replacementString = correctedCapitalization;
                }
                else {
                    replacementString = newName;
                }
                await addSingleWorkspaceEdit(edits, location, replacementString);
            }
            return edits;
        });
        return edits;
    }

    async prepareRename (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Range | null> {
        const documentMatches = await this.getDocumentMatch(document);
        if (!documentMatches) return null;
        const matchedNote = documentMatches.find(match => match.range.contains(position));
        if (!matchedNote) return null;
        return matchedNote.range;
    }

    getUpdatesAreVisible(): boolean {
        return true;
    }
}
