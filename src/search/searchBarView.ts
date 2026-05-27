import * as vscode from 'vscode';
import * as console from '../miscTools/vsconsole';
import { __, getNonce } from '../miscTools/help';
import { Extension } from   './../extension';
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
    field: 'useWholeWord'
        | 'useRegex'
        | 'useCaseInsensitive'
        | 'useMatchTitles'
        | 'useNodeDescriptions'
        | 'useIgnoreStyleCharacters',
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

export type SearchContext = {
    latestSearchBarValue: string;
    latestReplaceBarValue: string;
    useWholeWord: boolean;
    useRegex: boolean;
    useCaseInsensitive: boolean;
    useMatchTitles: boolean;
    useNodeDescriptions: boolean;
    useIgnoreStyleCharacters: boolean;
};

const SEARCH_TIMER = 2000;
export class SearchBarView 
extends 
    BounceOnIt<[string]>
implements 
    vscode.WebviewViewProvider, 
    Packageable<'wt.wtSearch.search.latestSearchBarValue' | 'wt.wtSearch.search.wholeWord' | 'wt.wtSearch.search.regex' | 'wt.wtSearch.search.caseInsensitive' | 'wt.wtSearch.search.matchTitles' | 'wt.wtSearch.search.nodeDescriptions' | 'wt.wtSearch.search.ignoreStyleCharacters'> 
{
    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    private latestSearchBarValue: string;
    private latestReplaceBarValue: string;
    private useWholeWord: boolean;
    private useRegex: boolean;
    private useCaseInsensitive: boolean;
    private useMatchTitles: boolean;
    private useNodeDescriptions: boolean;
    private useIgnoreStyleCharacters: boolean;

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace,
        private searchResults: SearchResultsView,
    ) { 
        super();

        this.latestSearchBarValue = this.context.workspaceState.get<string>('wt.wtSearch.search.latestSearchBarValue') || '';
        this.latestReplaceBarValue = this.context.workspaceState.get<string>('wt.wtSearch.search.latestReplaceBarValue') || '';
        this.useWholeWord = this.context.workspaceState.get<boolean>('wt.wtSearch.search.wholeWord') || false;
        this.useRegex = this.context.workspaceState.get<boolean>('wt.wtSearch.search.regex') || false;
        this.useCaseInsensitive = this.context.workspaceState.get<boolean>('wt.wtSearch.search.caseInsensitive') || false;
        this.useMatchTitles = this.context.workspaceState.get<boolean>('wt.wtSearch.search.matchTitles') || false;
        this.useNodeDescriptions = this.context.workspaceState.get<boolean>('wt.wtSearch.search.nodeDescriptions') || false;
        this.useIgnoreStyleCharacters = this.context.workspaceState.get<boolean>('wt.wtSearch.search.ignoreStyleCharacters') || false;

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

    isVisible(): boolean {
        return !!this._view?.visible;
    }

    getPackageItems () {
        return {
            'wt.wtSearch.search.latestSearchBarValue': this.latestSearchBarValue,
            'wt.wtSearch.search.wholeWord': this.useWholeWord,
            'wt.wtSearch.search.regex': this.useRegex,
            'wt.wtSearch.search.caseInsensitive': this.useCaseInsensitive,
            'wt.wtSearch.search.matchTitles': this.useMatchTitles,
            'wt.wtSearch.search.nodeDescriptions': this.useNodeDescriptions,
            'wt.wtSearch.search.ignoreStyleCharacters': this.useIgnoreStyleCharacters,
        }
    }
        
    private registerCommands () {
        this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
            const configuration = 'wt.wtSearch.slowMode';
            if (!e.affectsConfiguration(configuration)) return;
            this.setSlowModeValue();
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.searchError', this.setSearchBarError.bind(this)));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.getSearchContext', this.getSearchContext.bind(this)));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wtSearch.updateSearchBarValue', this.updateSearchBarValue.bind(this)));
    }

    public getSearchContext (): SearchContext {
        return {
            latestSearchBarValue: this.latestSearchBarValue,
            latestReplaceBarValue: this.latestReplaceBarValue,
            useWholeWord: this.useWholeWord,
            useRegex: this.useRegex,
            useCaseInsensitive: this.useCaseInsensitive,
            useMatchTitles: this.useMatchTitles,
            useNodeDescriptions: this.useNodeDescriptions,
            useIgnoreStyleCharacters: this.useIgnoreStyleCharacters
        };
    }

    private setSlowModeValue () {
        const slowModeValue = vscode.workspace.getConfiguration().get<boolean>('wt.wtSearch.slowMode');
        this._view?.webview.postMessage({
            kind: 'slowModeValueUpdated',
            slowMode: slowModeValue
        });
    }

    public async updateSearchBarValue (newSearchBarValue: string) {
        this.latestSearchBarValue = newSearchBarValue;
        Workspace.forcePackaging(this.context, 'wt.wtSearch.search.latestSearchBarValue', this.latestSearchBarValue);
        this._view?.webview.postMessage({
            kind: 'updateSearchBar',
            searchBar: this.latestSearchBarValue,
            focus: true,
        });
    }

    public setSearchBarError (errorBarValue: string, errorMessage: string) {
        if (this.latestSearchBarValue !== errorBarValue) return;
        this._view?.webview.postMessage(__<PostMessage>({ 
            kind: 'searchError',
            message: errorMessage
        }));
    }

    protected debouncedUpdate(cancellationToken: vscode.CancellationToken, searchBarValue: string): Promise<void> {
        Workspace.forcePackaging(this.context, 'wt.wtSearch.search.latestSearchBarValue', this.latestSearchBarValue);
        return this.searchResults.searchBarValueWasUpdated (
            searchBarValue, 
            this.useRegex, 
            this.useCaseInsensitive, 
            this.useMatchTitles, 
            this.useWholeWord, 
            this.useIgnoreStyleCharacters,
            cancellationToken
        );
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
                        case 'useWholeWord': Workspace.updateContext(this.context, 'wt.wtSearch.search.wholeWord', this.useWholeWord); break;
                        case 'useRegex': Workspace.updateContext(this.context, 'wt.wtSearch.search.regex', this.useRegex); break;
                        case 'useCaseInsensitive': Workspace.updateContext(this.context, 'wt.wtSearch.search.caseInsensitive', this.useCaseInsensitive); break;
                        case 'useMatchTitles': Workspace.updateContext(this.context, 'wt.wtSearch.search.matchTitles', this.useMatchTitles); break;
                        case 'useNodeDescriptions': Workspace.updateContext(this.context, 'wt.wtSearch.search.nodeDescriptions', this.useNodeDescriptions); break;
                        case 'useIgnoreStyleCharacters': Workspace.updateContext(this.context, 'wt.wtSearch.search.ignoreStyleCharacters', this.useIgnoreStyleCharacters); break;
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
                            this.searchResults.replace(this.latestSearchBarValue, this.latestReplaceBarValue, this.useRegex).then((success) => {
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
                                        <span id="warning-tooltip" class="tooltiptext"></span>
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
                                        <span id="warning-tooltip" class="tooltiptext"></span>
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
                                        title="Search text cannot be substring of a larger word. Will only search strings that are bookended with word stops: . ? : ; , ( ) ! & + - \\n \\ / &quot; ' ^ _ * ~ [ ], whitespace, BOF, and EOF."
                                        ${this.useWholeWord ? "checked" : ""}
                                        class="checkbox"
                                    ></vscode-checkbox>
                                
                                    &nbsp; &nbsp; &nbsp; &nbsp; 
                                    
                                    <vscode-checkbox 
                                        label="Regex"
                                        id="checkbox-regex" 
                                        name="regex" 
                                        title="Convert search string into a regex and search with that (NOTE: this option is incompatable with the &quot;Ignore Style Characters&quot; option)"
                                        ${this.useRegex ? "checked" : ""}
                                        class="checkbox"
                                        tooltip=""
                                    ></vscode-checkbox>

                                </div>

                                <div>
                                    <vscode-checkbox 
                                        label="Case Insensitive"
                                        id="checkbox-case-insensitive" 
                                        name="case-insensitive" 
                                        title="Latin alphabet characters upper/lower case will be ignored in search"
                                        ${this.useCaseInsensitive ? "checked" : ""}
                                        class="checkbox"
                                    ></vscode-checkbox>

                                    &nbsp; &nbsp; 

                                    <vscode-checkbox 
                                        label="Match Titles"
                                        id="checkbox-match-titles" 
                                        name="match-titles" 
                                        title="Nodes in the Outline Tree with titles that match search string will also be shown in results"
                                        ${this.useMatchTitles ? "checked" : ""}
                                        class="checkbox"
                                    ></vscode-checkbox>
                                </div>

                                <div>
                                    <vscode-checkbox 
                                        label="Node Descriptions"
                                        id="checkbox-node-descriptions" 
                                        name="node-descriptions" 
                                        title="Nodes in the Outline Tree with node descriptions that match the search string will also be shown in results"
                                        ${this.useNodeDescriptions ? "checked" : ""}
                                        class="checkbox"
                                    ></vscode-checkbox>

                                    &nbsp; &nbsp; 

                                    <vscode-checkbox 
                                        label="Ignore Style Characters"
                                        id="checkbox-ignore-style-characters" 
                                        name="ignore-style-characters" 
                                        title="Search string will ignore markdown/writing tool style characters when searching. So search='hello' will match text='hello' as well as text='h**e_l^l*o'. (NOTE: this option is incompatable with the &quot;Regex&quot; option)"
                                        ${this.useIgnoreStyleCharacters ? "checked" : ""}
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