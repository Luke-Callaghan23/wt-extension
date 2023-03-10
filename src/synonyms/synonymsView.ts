import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { getNonce } from '../help';
import { Packageable } from '../packageable';
import { Workspace } from '../workspace/workspace';

export class SynonymViewProvider implements vscode.WebviewViewProvider, Packageable {

	private _view?: vscode.WebviewView;
	private synonyms: string[];
	private readonly _extensionUri: vscode.Uri;

	constructor (
        private context: vscode.ExtensionContext,
		workspace: Workspace
	) { 
		this.synonyms = this.context.workspaceState.get('wt.synonyms.synonyms') ?? ['big', 'sad', 'great'];

		
		this._extensionUri = context.extensionUri;
        context.subscriptions.push (
			vscode.window.registerWebviewViewProvider('wt.synonyms', this)
		);

		this.registerCommands();
	}

	getPackageItems (): { [index: string]: any; } {
		return {
			'wt.synonyms.synonyms': this.synonyms
		}
	}
		
	private registerCommands () {
			
		vscode.commands.registerCommand('wt.synonyms.clearSynonyms', () => {
			this.clearSynonyms();
		});
		
		vscode.commands.registerCommand('wt.synonyms.addSynonym', (term) => {
			this.addSynonym(term);
		});

		vscode.commands.registerCommand("wt.synonyms.help", () => {
			vscode.window.showInformationMessage(`Synonyms`, {
                modal: true,
                detail: `The synonyms panel is an area where you can quickly look up synonyms/definitions to words.`
            }, 'Okay');
		});

		vscode.commands.registerCommand("wt.synonyms.searchWord", () => {
			(async () => {
				// Get the active text editor
				const editor = vscode.window.activeTextEditor;
	
				if (editor) {
					const document = editor.document;
					let selection = editor.selection;
			
	
					if (selection.isEmpty) {
						// If the selection is empty, then use smartSelect.grow to grow the selection to surround the current word
						// 		and force the selection to be the current word
						await vscode.commands.executeCommand('editor.action.smartSelect.grow');
						selection = editor.selection;
						if (selection.isEmpty) {
							// If the selection is still empty, there's nothing we can do
							return;
						}
					}
	
					// Get the seleccted text within the selection
					const selected: string = document.getText(selection);
					
					// If there is a space in the selected text, then split the string on that space, and search only the first
					//		word in the selection
					let text: string;
					if (/\s/.test(selected)) {
						text = selected.split(/\s/)[0];
						if (text === '') {
							// Do not allow empty searches
							return;
						}
						vscode.window.showWarningMessage(`WARN: Cannot query for synonyms of multiple words at once.  Using the first word in selection '${text}' instead.`);
					}
					else {
						text = selected;
					}
					this.addSynonym(text);
				}
			})();
		});
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
		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'pasteSynonym':
					vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(`${data.value}`));
					break;
				case 'failedSeach':
					const failedWord: string = data.word;
					const suggestedWords: string[] = data.suggestions;
					const suggestedString = suggestedWords.join("', '");
					vscode.window.showErrorMessage(`Error: The dictionary api did not recognize search term '${failedWord}'. Did you mean to type one of these: '${suggestedString}'?`);
					break;
				case 'requestDictionaryApiKey': 
					const dictionaryApi = "29029b50-e0f1-4be6-ac00-77ab8233e66b";
					if (!dictionaryApi) {
						vscode.window.showWarningMessage(`WARN: The synonyms view uses a dictionary API to function.  If you forked this code from github, you need to get your own API key from 'https://dictionaryapi.dev/'`);
						return;
					}
					webviewView.webview.postMessage({
						type: 'startupDelivery',
						dicationatyApi: dictionaryApi,
						synonyms: this.synonyms
					});
					break;
				case 'deliveredSynonyms':
					this.synonyms = (data.synonyms as string[]);
					this.context.workspaceState.update('wt.synonyms.synonyms', this.synonyms);
					break;
			}
		});
	}

	public addSynonym (term: string) {
		if (this._view) {
			this._view.show?.(true);
			this._view.webview.postMessage({
				type: 'addSynonym',
				term: term,
			});
		}
	}

	public clearSynonyms() {
		if (this._view) {
			this._view.webview.postMessage({ type: 'clearSynonyms' });
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/synonyms/main.js`));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/reset.css`));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/vscode.css`));
		const styleIconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/icons.css`));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/synonyms/main.css`));
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
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src https://dictionaryapi.com;">
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
							<div class="color-entry">
								<div class="icon" id="search-icon"><i class="codicon codicon-search"></i></div>
								<input class="color-input" type="text" placeholder="Search . . ." id="search-bar">
							</div>
							<div class="bar"></div>
							<h1 id="startup-message">Type in the search bar to find some synonyms!</h1>
							<div class="collapsible-container" id="synonym-box"></div>
						</div>
					</div>
					<button disabled class="add-color-button">Clear Synonyms</button>
					<script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
			</html>`;
	}
}