import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../vsconsole';
import  * as extension from '../extension';
import { getNonce } from '../help';
import { handleImport, ImportDocumentInfo } from './importFiles';

type RequestDocuments = {
	type: 'requestDocuments'
};

type Submit = {
	type: 'submit',
	docInfo: ImportDocumentInfo
};

type Message = RequestDocuments | Submit;

type SentDocument = {
	fullPath: string,
	name: string,
	ext: string,
};

export class ImportForm {

	private panel: vscode.WebviewPanel;

	constructor(
		private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
		private documents: vscode.Uri[]
	) { 

		const panel = vscode.window.createWebviewPanel (
			'wt.import.importForm',
			'Import Form',
			vscode.ViewColumn.Active,
			{
				enableScripts: true
			}
		);

		
		panel.webview.onDidReceiveMessage((e) => this.handleMessage(e));
		panel.webview.html = this._getHtmlForWebview(panel.webview, context.extensionPath);
		this.panel = panel;
    }

	async handleDocumentRequest () {

		// Retrieve chapter uris and names from the outline view
		const chapterUris: [string, string][] = await vscode.commands.executeCommand('wt.outline.collectChapterUris');
		// const extensionRootFs = extension.rootPath.fsPath.replace(/.*:/, '');
		const sentDocs = this.documents.map(documentUri => {

			const name = vscodeUris.Utils.basename(documentUri);
			const ext = vscodeUris.Utils.extname(documentUri);
			const fullPath = documentUri.fsPath.replace(extension.rootPath.fsPath, '');
			return {
				fullPath, name, ext
			};
		});
		return this.sendDocuments({
			chapterUris: chapterUris,
			documents: sentDocs
		});
	}
	
	async sendDocuments (sentDocuments: {
		chapterUris: [ string, string ][],
		documents: SentDocument[]
	}) {
		this.panel.webview.postMessage({
			type: 'sentDocuments',
			...sentDocuments
		});
	}

	
	
	handleImport = handleImport;
	async handleMessage (data: Message) {
		switch (data.type) {
			case 'requestDocuments':
				await this.handleDocumentRequest();
				break;
			case 'submit':
				await this.handleImport(data.docInfo);
				this.panel.dispose();
				break;
		}
	}



	private _getHtmlForWebview (webview: vscode.Webview, _extensionUri: string) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/import/main.js`));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/reset.css`));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/vscode.css`));
		const styleIconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/icons.css`));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/import/main.css`));

		const codiconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@vscode/codicons/dist/codicon.css`));
		const elementsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@bendera/vscode-webview-elements/dist/bundled.js`));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		const fileUri = (fp: string) => {
			const fragments = fp.split('/');
	
			const uri = vscode.Uri.file(_extensionUri)
			return vscode.Uri.joinPath(uri, ...fragments);
		};

		const assetUri = (fp: string) => {
			return webview.asWebviewUri(fileUri(fp));
		};

		return `<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<!--
						Use a content security policy to only allow loading styles from our extension directory,
						and only allow scripts that have a specific nonce.
						(See the 'webview-sample' extension sample for img-src content security policy examples)
					-->
					<meta 
						http-equiv="Content-Security-Policy" 
						content="
							default-src 'none'; 
							font-src ${webview.cspSource}; 
							style-src 'unsafe-inline' ${webview.cspSource}; 
							script-src ${webview.cspSource}
							nonce-${nonce};
							style-src-elem 'unsafe-inline' ${webview.cspSource};
						"
					>
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<link href="${styleIconsUri}" rel="stylesheet">
					<link href="${styleResetUri}" rel="stylesheet">
					<link href="${styleVSCodeUri}" rel="stylesheet">
					<link href="${styleMainUri}" rel="stylesheet">
					<link href="${codiconsUri}" rel="stylesheet">
					<title>Cat Colors</title>
				</head>
                <body class="doc-body">
					<div id="form-container" class="form-container"></div>
					<script src="${elementsUri}" nonce="${nonce}" type="module"></script>
					<script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
			</html>`;
	}
}