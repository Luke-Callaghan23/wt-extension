import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import * as console from '../miscTools/vsconsole';
import  * as extension from '../extension';
import { getNonce } from '../miscTools/help';
import { DocInfo, handleImport, handlePreview, ImportDocumentInfo } from './importFiles';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';

type RequestDocuments = {
	type: 'requestDocuments'
};

type Submit = {
	type: 'submit',
	docInfo: ImportDocumentInfo
};

type Preview = {
	type: 'preview',
	docName: string,
	singleDoc: DocInfo,
}

type Message = RequestDocuments | Submit | Preview;

type SentDocument = {
	fullPath: string,
	name: string,
	ext: string,
};


export type Li = {
	name: string;
	children: Li[];
}

export type DroppedSourceInfo = {
	node: OutlineNode,
	namePath: string,
	destination: 'chapter' | 'snip',
};

export class ImportForm {

	private panel: vscode.WebviewPanel;

	constructor(
		private readonly _extensionUri: vscode.Uri,
        private context: vscode.ExtensionContext,
		private documents: vscode.Uri[],
		private droppedSource?: DroppedSourceInfo
	) { 

		const panel = vscode.window.createWebviewPanel (
			'wt.import.importForm',
			'Import Form',
			vscode.ViewColumn.Active,
			{ enableScripts: true }
		);

		this.context.subscriptions.push(panel.webview.onDidReceiveMessage((e) => this.handleMessage(e)));
		this.context.subscriptions.push(panel);
		panel.webview.html = this._getHtmlForWebview(panel.webview, context.extensionPath);
		this.panel = panel;
    }

	async handleDocumentRequest () {

		// Retrieve chapter uris and names from the outline view
		const chapterUris: [string, string][] = await vscode.commands.executeCommand('wt.outline.collectChapterUris');
		const sentDocs = this.documents.map(documentUri => {

			const name = vscodeUris.Utils.basename(documentUri);
			const ext = vscodeUris.Utils.extname(documentUri);
			const fullPath = documentUri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');;
			return {
				fullPath, name, ext
			};
		});
		return this.sendDocuments({
			chapterUris: chapterUris,
			documents: sentDocs,
			droppedSource: this.droppedSource ? {
				namePath: this.droppedSource.namePath,
				destination: this.droppedSource.destination
			} : null
		});
	}
	
	async sendDocuments (sentDocuments: {
		chapterUris: [ string, string ][],
		documents: SentDocument[],
		droppedSource: Omit<DroppedSourceInfo, 'node'> | null,
	}) {
		this.panel.webview.postMessage({
			type: 'sentDocuments',
			...sentDocuments
		});
	}
	
	async handleMessage (data: Message) {
		switch (data.type) {
			case 'requestDocuments':
				await this.handleDocumentRequest();
				break;
			case 'submit':
				await handleImport(data.docInfo, this.droppedSource || null);
				this.panel.dispose();
				break;
			case 'preview':
				const li = await handlePreview(data.docName, data.singleDoc, this.droppedSource || null);
				this.panel.webview.postMessage({
					type: 'preview',
					preview: li,
				});
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
		const elementsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@vscode-elements/elements/dist/bundled.js`));

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
				</head>
                <body class="doc-body">
					<div id="form-container" class="form-container"></div>
					<script src="${elementsUri}" nonce="${nonce}" type="module"></script>
					<script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
			</html>`;
	}
}