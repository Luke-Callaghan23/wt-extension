import * as vscode from 'vscode';
import * as console from '../miscTools/vsconsole';
import { getNonce } from '../miscTools/help';
import { Packageable } from '../packageable';
import { Workspace } from '../workspace/workspaceClass';
import { SerializedNote, WTNotebookSerializer } from './notebookApi/notebookSerializer';
import { ExtensionGlobals } from '../extension';
import * as MarkdownIt from 'markdown-it';
import { NotebookPanel, NotebookPanelNote } from './notebookPanel';

export class NotebookWebview implements vscode.WebviewViewProvider {

    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    private selectedNoteId: string | null;

    // maps note id -> rendered note html
    private noteHtmls: Record<string, {
        title: string,
        html: string,
    }>;

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace
    ) { 
        this._extensionUri = context.extensionUri;
        try {
            context.subscriptions.push(vscode.window.registerWebviewViewProvider('wt.notebook.webview', this));
        }
        catch (e) {
            console.log(`${e}`);
        }
        this.selectedNoteId = null;
        this.noteHtmls = {};
        this.registerCommands();
    }

    private registerCommands () {
        
    }

    public visible() {
        return !!this._view?.visible;
    }

    public reveal (note: NotebookPanelNote) {
        this.updateViewForNote(note.noteId);
        this._view?.show(true);
    }
    
    public resolveWebviewView (
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [ this._extensionUri ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this.context.subscriptions.push(webviewView.webview.onDidReceiveMessage(data => {
            this.updateViewForNote(data);
        }));
    }

    // notes: map note id -> note markdown
    public async updateViewHtml (notebookPanel: NotebookPanel, notes: NotebookPanelNote[]) {
        
        this.noteHtmls = {};
        for (const note of notes) {
            
            const aliasString = notebookPanel.getAliasString(note);
            const markdown = notebookPanel.getMarkdownForNote(note);
            
            // @ts-ignore - not sure why this is reported as an error
            const mdit = new MarkdownIt({
                linkify: true,
                breaks: true,
                html: true,
            });
            const noteHtml = mdit.render(markdown);
            this.noteHtmls[note.noteId] = {
                html: noteHtml,
                title: aliasString
            } 
        }
        
        if (!this._view) return;
        const html = this._getHtmlForWebview(this._view.webview);
        this._view.webview.html = html;
    }

    updateViewForNote(noteId: string) {
        if (!this._view) return;

        this.selectedNoteId = noteId;
        const html = this._getHtmlForWebview(this._view?.webview);
        this._view.webview.html = html;
    }


    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        // const scriptUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/synonyms/main.js`));

        // Do the same for the stylesheet.
        const styleResetUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/reset.css`));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/vscode.css`));
        const styleIconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/icons.css`));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/synonyms/main.css`));
        const elementsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@vscode-elements/elements/dist/bundled.js`));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@vscode/codicons/dist/codicon.css`));

        let noteHtml: string | null = null;

        const noteSelects: string[] = [];
        if (this.selectedNoteId === null) {
            noteSelects.push(`<vscode-option selected value="..."><i>Select a notebook . . . </i></vscode-option>`);
        }

        for (const [ noteId, { html, title } ] of Object.entries(this.noteHtmls)) {
            
            let titleString = title;
            if (title.length > 40) {
                titleString = title.substring(0, 40) + "...";
            }
            
            if (noteId === this.selectedNoteId) {
                noteHtml = html;
                noteSelects.push(`<vscode-option selected value="${noteId}">${titleString}</vscode-option>`);
            }
            else {
                noteSelects.push(`<vscode-option value="${noteId}">${titleString}</vscode-option>`);                
            }
        }

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <!--
                        Use a content security policy to only allow loading styles from our extension directory,
                        and only allow scripts that have a specific nonce.
                        (See the 'webview-sample' extension sample for img-src content security policy examples)
                    -->
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <link href="${styleIconsUri}" rel="stylesheet">
                    <link href="${styleResetUri}" rel="stylesheet">
                    <link href="${styleVSCodeUri}" rel="stylesheet">
                    <link href="${styleMainUri}" rel="stylesheet">
                    <link href="${codiconsUri}" rel="stylesheet" id="vscode-codicon-stylesheet">
                    <title>Synonyms</title>
                </head>
                <style>
                    body {
                        font-size: 15px;
                    }
                </style>    
                <body>
                
					<script src="${elementsUri}" nonce="${nonce}" type="module"></script>
                    <script nonce="${nonce}" type="module">
                        (function () {
                            const vscode = acquireVsCodeApi();

                            const element = document.getElementById("select-note");
                            element.addEventListener('change', (select) => {
                                // Once the page is loaded, request the api key from the main environment
                                vscode.postMessage(select.target.value);
                            });
                        }());
                    </script>

                    <vscode-form-container id="log-settings-form">
                        <vscode-label for="select-note" class="label">Notebook:</vscode-label>
                        <vscode-single-select id="select-note" name="select-note" class="select select-note">
                            ${noteSelects.join('')}
                        </vscode-single-select>
                    </vscode-form-container>
                    
                    <hr />

                    ${noteHtml || '<h1>Nothing hovered yet</h1>'}
                </body>
            </html>`;
    }
}