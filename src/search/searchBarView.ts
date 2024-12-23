import * as vscode from 'vscode';
import * as console from '../miscTools/vsconsole';
import { getNonce } from '../miscTools/help';
import { Packageable } from '../packageable';
import { Workspace } from '../workspace/workspaceClass';
import { SearchResultsView } from './searchResultsView';
import { DiskContextType } from '../workspace/workspace';
import { wordSeparator } from '../extension';



type WebviewMessage = {
    kind: 'textBoxChange',
    input: 'search' | 'replace',
    value: string,
} | {
    kind: 'checkbox',
    field: 'wholeWord' | 'regex' | 'caseInsensitive' | 'matchTitles',
    checked: boolean
};


const SEARCH_TIMER = 2000;
export class SearchBarView implements vscode.WebviewViewProvider, Packageable {

    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    private latestSearchBarValue: string;
    private wholeWord: boolean;
    private regex: boolean;
    private caseInsensitive: boolean;
    private matchTitles: boolean;

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private searchResults: SearchResultsView,
    ) { 
        this.latestSearchBarValue = this.context.workspaceState.get<string>('wt.wtSearch.search.latestSearchBarValue') || '';
        this.wholeWord = this.context.workspaceState.get<boolean>('wt.wtSearch.search.wholeWord') || false;
        this.regex = this.context.workspaceState.get<boolean>('wt.wtSearch.search.regex') || false;
        this.caseInsensitive = this.context.workspaceState.get<boolean>('wt.wtSearch.search.caseInsensitive') || false;
        this.matchTitles = this.context.workspaceState.get<boolean>('wt.wtSearch.search.matchTitles') || false;

        this._extensionUri = context.extensionUri;
        try {
            context.subscriptions.push (
                vscode.window.registerWebviewViewProvider('wt.wtSearch.search', this)
            );
        }
        catch (e) {
            console.log(`${e}`);
        }

        if (this.latestSearchBarValue.length > 0) {
            this.triggerUpdates(this.latestSearchBarValue);
        }

        this.registerCommands();
    }

    getPackageItems (): Partial<DiskContextType> {
        return {
            'wt.wtSearch.search.latestSearchBarValue': this.latestSearchBarValue,
            'wt.wtSearch.search.wholeWord': this.wholeWord,
            'wt.wtSearch.search.regex': this.regex,
            'wt.wtSearch.search.caseInsensitive': this.caseInsensitive,
            'wt.wtSearch.search.matchTitles': this.matchTitles,
        }
    }
        
    private registerCommands () {
    }

    private async triggerUpdates (searchBarValue: string) {
        const flags = 'g' + this.caseInsensitive ? 'i' : '';
        if (!this.regex) {
            searchBarValue = searchBarValue.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        if (this.wholeWord) {
            const shellWordSeparatorStart = '(^|\\s|-|[.?:;,()\\!\\&+n\\"\'^_*~])';
            const shellWordSeparatorEnd = '(\\s|-|[.?:;,()\\!\\&+n\\"\'^_*~]|$)';
            return this.searchResults.searchBarValueWasUpdated(
                new RegExp(`${shellWordSeparatorStart}(${searchBarValue})${shellWordSeparatorEnd}`, flags),
                this.matchTitles,
                {
                    regexWithIdGroup: new RegExp(`${shellWordSeparatorStart}(?<searchTerm>${searchBarValue})${shellWordSeparatorEnd}`, 'gi'),
                    captureGroupId: 'searchTerm',
                }
            );
        }
        return this.searchResults.searchBarValueWasUpdated(new RegExp(searchBarValue, flags), this.matchTitles);
    }

    private lastRequest: number = 0;
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
        webviewView.webview.onDidReceiveMessage(data => {
            const message = data as WebviewMessage;
            switch (message.kind) {
                case 'checkbox': 
                    this[message.field] = message.checked;
                    switch (message.field) {
                        case 'wholeWord': Workspace.updateContext(this.context, 'wt.wtSearch.search.wholeWord', this.wholeWord); break;
                        case 'regex': Workspace.updateContext(this.context, 'wt.wtSearch.search.regex', this.regex); break;
                        case 'caseInsensitive': Workspace.updateContext(this.context, 'wt.wtSearch.search.caseInsensitive', this.caseInsensitive); break;
                        case 'matchTitles': Workspace.updateContext(this.context, 'wt.wtSearch.search.matchTitles', this.matchTitles); break;
                    }
                    if (this.latestSearchBarValue.length !== 0) {
                        this.triggerUpdates(this.latestSearchBarValue);
                    }
                    break;
                case 'textBoxChange': 
                    const textbox = message.value;
                    this.latestSearchBarValue = textbox;
                    Workspace.updateContext(this.context, 'wt.wtSearch.search.latestSearchBarValue', this.latestSearchBarValue);
                    if (textbox.length === 0) {
                        this.searchResults.searchCleared();
                        return;
                    }
                    this.triggerUpdates(textbox);
                    break;
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/search/main.js`));

        // Do the same for the stylesheet.
        const styleResetUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/reset.css`));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/vscode.css`));
        const styleIconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/icons.css`));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/search/main.css`));
        const elementsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@bendera/vscode-webview-elements/dist/bundled.js`));
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
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src https://www.wordhippo.com;">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <link href="${styleIconsUri}" rel="stylesheet">
                    <link href="${styleResetUri}" rel="stylesheet">
                    <link href="${styleVSCodeUri}" rel="stylesheet">
                    <link href="${styleMainUri}" rel="stylesheet">
                    <link href="${codiconsUri}" rel="stylesheet" id="vscode-codicon-stylesheet">
                    <title>Synonyms</title>
                </head>
                <body>
                    <script src="${elementsUri}" nonce="${nonce}" type="module"></script>
                    <div class="input-icon">
                        <div class="color-list">
                            <div class="float" id="scroll-header">
                                <div class="bar"></div>
                                <div class="color-entry">
                                    <input class="color-input" type="text" placeholder="Search . . ." id="search-bar" value="${this.latestSearchBarValue}">
                                    <div class="icon" id="search-icon"><i class="codicon codicon-search"></i></div>
                                </div>
                            </div>
                            
                            <div class="float" id="scroll-header">
                                <div class="bar"></div>
                                <div class="color-entry">
                                    <input class="color-input" type="text" placeholder="Replace" id="replace-bar">
                                </div>
                            </div>
                            <div id="checks">
                                <div>
                                    <vscode-checkbox 
                                        label="Whole Word"
                                        id="checkbox-whole-word" 
                                        name="whole-word" 
                                        ${this.wholeWord ? "checked" : ""}
                                        class="checkbox"
                                    ></vscode-checkbox>
                                
                                    &nbsp; &nbsp; &nbsp; &nbsp; 
                                    
                                    <vscode-checkbox 
                                        label="Regex"
                                        id="checkbox-regex" 
                                        name="regex" 
                                        ${this.regex ? "checked" : ""}
                                        class="checkbox"
                                        tooltip=""
                                    ></vscode-checkbox>

                                </div>

                                <div>
                                    <vscode-checkbox 
                                        label="Case Insensitive"
                                        id="checkbox-case-insensitive" 
                                        name="case-insensitive" 
                                        ${this.caseInsensitive ? "checked" : ""}
                                        class="checkbox"
                                    ></vscode-checkbox>

                                    &nbsp; &nbsp; 

                                    <vscode-checkbox 
                                        label="Match Titles"
                                        id="checkbox-match-titles" 
                                        name="match-titles" 
                                        ${this.matchTitles ? "checked" : ""}
                                        class="checkbox"
                                    ></vscode-checkbox>
                                </div>
                            </div>
                        </div>
                    </div>
                    <script nonce="${nonce}" src="${scriptUri}"></script>
                </body>
            </html>`;
    }
}