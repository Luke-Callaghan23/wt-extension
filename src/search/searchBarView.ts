import * as vscode from 'vscode';
import * as console from '../miscTools/vsconsole';
import { __, getNonce } from '../miscTools/help';
import * as extension from './../extension';
import { Packageable } from '../packageable';
import { DiskContextType, Workspace } from '../workspace/workspaceClass';
import { SearchResultsView } from './searchResultsView';
import { ReloadWatcher } from '../miscTools/reloadWatcher';
import { Buff } from '../Buffer/bufferSource';
import { BounceOnIt } from '../miscTools/bounceOnIt';


type WebviewMessage = {
    kind: 'textBoxChange',
    input: 'search' | 'replace',
    value: string,
    push: boolean
} | {
    kind: 'checkbox',
    field: 'wholeWord' | 'regex' | 'caseInsensitive' | 'matchTitles',
    checked: boolean
} | {
    kind: 'ready',
};

type PostMessage = {
    kind: 'slowModeValueUpdated',
    slowMode: boolean
} | {
    kind: 'searchError',
    message: string
}


const SEARCH_TIMER = 2000;
export class SearchBarView 
extends 
    BounceOnIt<[string]>
implements 
    vscode.WebviewViewProvider, 
    Packageable<'wt.wtSearch.search.latestSearchBarValue' | 'wt.wtSearch.search.wholeWord' | 'wt.wtSearch.search.regex' | 'wt.wtSearch.search.caseInsensitive' | 'wt.wtSearch.search.matchTitles'> 
{
    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    private latestSearchBarValue: string;
    private latestReplaceBarValue: string;
    private wholeWord: boolean;
    private regex: boolean;
    private caseInsensitive: boolean;
    private matchTitles: boolean;

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private searchResults: SearchResultsView,
    ) { 
        super();

        this.latestSearchBarValue = this.context.workspaceState.get<string>('wt.wtSearch.search.latestSearchBarValue') || '';
        this.latestReplaceBarValue = this.context.workspaceState.get<string>('wt.wtSearch.search.latestReplaceBarValue') || '';
        this.wholeWord = this.context.workspaceState.get<boolean>('wt.wtSearch.search.wholeWord') || false;
        this.regex = this.context.workspaceState.get<boolean>('wt.wtSearch.search.regex') || false;
        this.caseInsensitive = this.context.workspaceState.get<boolean>('wt.wtSearch.search.caseInsensitive') || false;
        this.matchTitles = this.context.workspaceState.get<boolean>('wt.wtSearch.search.matchTitles') || false;

        this._extensionUri = context.extensionUri;
        try {
            context.subscriptions.push (vscode.window.registerWebviewViewProvider('wt.wtSearch.search', this));
        }
        catch (e) {
            console.log(`${e}`);
        }

        if (this.latestSearchBarValue.length > 0) {
            this.triggerDebounce(this.latestSearchBarValue);
        }

        this.registerCommands();
    }

    getPackageItems () {
        return {
            'wt.wtSearch.search.latestSearchBarValue': this.latestSearchBarValue,
            'wt.wtSearch.search.wholeWord': this.wholeWord,
            'wt.wtSearch.search.regex': this.regex,
            'wt.wtSearch.search.caseInsensitive': this.caseInsensitive,
            'wt.wtSearch.search.matchTitles': this.matchTitles,
        }
    }
        
    private registerCommands () {
        this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
            const configuration = 'wt.wtSearch.slowMode';
            if (!e.affectsConfiguration(configuration)) return;
            this.setSlowModeValue();
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.searchError', (errorBarValue: string, errorMessage) => {
            return this.searchBarError(errorBarValue, errorMessage);
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.getSearchContext', () => {
            return [
                this.latestSearchBarValue,
                this.latestReplaceBarValue,
                this.wholeWord,
                this.regex,
                this.caseInsensitive,
                this.matchTitles
            ]
        }))
    }

    private setSlowModeValue () {
        const slowModeValue = vscode.workspace.getConfiguration().get<boolean>('wt.wtSearch.slowMode');
        this._view?.webview.postMessage({
            kind: 'slowModeValueUpdated',
            slowMode: slowModeValue
        });
    }

    public searchBarError (errorBarValue: string, errorMessage: string) {
        if (this.latestSearchBarValue !== errorBarValue) return;
        this._view?.webview.postMessage(__<PostMessage>({ 
            kind: 'searchError',
            message: errorMessage
        }));
    }

    protected debouncedUpdate(cancellationToken: vscode.CancellationToken, searchBarValue: string): Promise<void> {
        Workspace.forcePackaging(this.context, 'wt.wtSearch.search.latestSearchBarValue', this.latestSearchBarValue);
        return this.searchResults.searchBarValueWasUpdated(searchBarValue, this.regex, this.caseInsensitive, this.matchTitles, this.wholeWord, cancellationToken);
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

        const refreshHtml = () => {
            webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        };

        this.context.subscriptions.push(this._view.onDidChangeVisibility(() => {
            refreshHtml();
        }))

        refreshHtml();
        this.context.subscriptions.push(webviewView.webview.onDidReceiveMessage(data => {
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
                        this.triggerDebounce(this.latestSearchBarValue);
                    }
                    break;
                case 'textBoxChange': 
                    if (message.input === 'replace') {
                        this.latestReplaceBarValue = message.value;
                        Workspace.forcePackaging(this.context, 'wt.wtSearch.search.latestReplaceBarValue', this.latestReplaceBarValue);
                        if (message.push) {
                            this.searchResults.replace(this.latestSearchBarValue, this.latestReplaceBarValue, this.regex).then((success) => {
                                if (success) {
                                    this.triggerDebounce(this.latestSearchBarValue);
                                }
                            });
                        }
                    }
                    else {
                        this.latestSearchBarValue = message.value;
                        
                        if (message.push) {
                            if (message.value.length > 0) {
                                this.triggerDebounce(message.value);
                            }
                            else {
                                this.cancelTokens();
                                Workspace.forcePackaging(this.context, 'wt.wtSearch.search.latestSearchBarValue', this.latestSearchBarValue);
                                this.searchResults.searchCleared();
                            }
                        }
                    }
                    
                    break;
                case 'ready':
                    this.setSlowModeValue();
            }
        }));
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/search/main.js`));

        // Do the same for the stylesheet.
        const styleResetUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/reset.css`));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/vscode.css`));
        const styleIconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/icons.css`));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/search/main.css`));
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
                                    <div class="tooltip">
                                        <input class="color-input" type="text" placeholder="Search . . ." id="search-bar" value="${this.latestSearchBarValue}">
                                        <span id="error-tooltip" class="tooltiptext"></span>
                                    </div>
                                    <div class="icon" id="search-icon"><i class="codicon codicon-search"></i></div>
                                </div>
                            </div>
                            
                            <div class="float" id="scroll-header">
                                <div class="bar"></div>
                                <div class="color-entry">
                                    <div class="tooltip">
                                        <input class="color-input" type="text" placeholder="Replace" id="replace-bar">
                                        <span id="error-tooltip" class="tooltiptext"></span>
                                    </div>
                                    <div class="icon" id="replace-icon"><i class="codicon codicon-replace-all"></i></div>
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