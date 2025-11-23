import * as vscode from 'vscode';
import * as console from '../../miscTools/vsconsole';
import { getNonce } from '../../miscTools/help';
import { Packageable } from '../../packageable';
import { Workspace } from '../../workspace/workspaceClass';
import { ExtensionGlobals } from '../../extension';
import * as MarkdownIt from 'markdown-it';
import { HoverProvider } from '../synonyms/hoverProvider';
import { getHoveredWord, getHoverMarkdown } from '../common';
import { SynonymProviderType } from './provideSynonyms';

export class DefinitionsPanelWebview implements vscode.WebviewViewProvider, vscode.HoverProvider {

    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace
    ) { 
        this._extensionUri = context.extensionUri;
        this.context.subscriptions.push(vscode.window.registerWebviewViewProvider('wt.definitions', this));
        this.context.subscriptions.push(vscode.languages.registerHoverProvider({
            language: 'wt',
        }, this));
        this.context.subscriptions.push(vscode.languages.registerHoverProvider({
            language: 'wtNote',
        }, this));
        this.registerCommands();
    }

    private registerCommands () {
        this.context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((ev) => {
            this.checkSelection(ev.textEditor.document, ev.textEditor.selection);
        }, this));
    }

    public visible() {
        return !!this._view?.visible;
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

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, null);
        this.context.subscriptions.push(webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
            }
        }));
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        this.checkSelection(document, new vscode.Selection(position, position));
        return null;
    }

    async checkSelection (document: vscode.TextDocument, selection: vscode.Selection) {
        const position = selection.active;
        const hover = getHoveredWord(document, position);
        if (!hover) return;

        const currentProvider: SynonymProviderType = await vscode.commands.executeCommand('wt.intellisense.synonyms.getCurrentProvider');
        const hoverMd = await getHoverMarkdown(hover.text, currentProvider);
        if (!hoverMd) return;

        return this.updateViewForDefinition(hoverMd);
    }


    public async updateViewForDefinition (noteMd: string) {
        if (!this._view) return;

        const mdit = new MarkdownIt({
            linkify: true,
            breaks: true,
            html: true,
        });
        const noteHtml = mdit.render(noteMd);
        const html = this._getHtmlForWebview(this._view.webview, noteHtml);;
        this._view.webview.html = html;
    }

    private _getHtmlForWebview(webview: vscode.Webview, noteHtml: string | null) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        // const scriptUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/synonyms/main.js`));

        // Do the same for the stylesheet.
        const styleResetUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/reset.css`));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/vscode.css`));
        const styleIconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/icons.css`));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/synonyms/main.css`));
        const elementsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@vscode-elements/elements/dist/bundled.js`));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@vscode/codicons/dist/codicon.css`));

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
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src 'self' 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src https://dictionaryapi.com;">
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
                    ${noteHtml || '<h1>Nothing hovered yet</h1>'}
                </body>
            </html>`;
    }
}