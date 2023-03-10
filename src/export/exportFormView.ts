/* eslint-disable curly */
import * as vscode from 'vscode';
import * as console from '../vsconsole';
import  * as extension from '../extension';
import { getNonce } from '../help';
import { handleDocumentExport, ExportDocumentInfo } from './exportDocuments';
import { handleWorkspaceExport } from '../workspace/importExport/exportWorkspace';
import { Workspace } from '../workspace/workspace';
import { OutlineView } from '../outline/outlineView';

type Submit = {
	type: 'submit',
	exportInfo: ExportDocumentInfo
};

type Message = Submit;


export class ExportForm {

	// Static method that initializes the commands needed for exporting 
	static registerCommands (
		_extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
		workspace: Workspace,
		outlineView: OutlineView
	) {
		// Export the workspace
		vscode.commands.registerCommand('wt.export.exportWorkspace', () => handleWorkspaceExport(_extensionUri, context, workspace, outlineView));
		// Export documents
		vscode.commands.registerCommand('wt.export.exportDocuments', () => {
			// Inform the user that the export only considers fragments within chapters
			const promise = vscode.window.showInformationMessage(`Snips will be ignored!`, {
				modal: true,
				detail: 'The only fragments that are considered while exporting a work are those fragments inside of a chapter.  Please move all work that you want to be exported into existing chapters before continuing with export.'
			}, 'Continue Export');
			promise.then((proceed) => {
				if (proceed === undefined) return;
				new ExportForm(_extensionUri, context, workspace, outlineView);
			});
		});
	}
	
	// Creates and initializes the html for a webview panel
	private panel: vscode.WebviewPanel;
	constructor(
		private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
		private workspace: Workspace,
		private outline: OutlineView
	) { 
		// Create the webview panel and set html
		const panel = vscode.window.createWebviewPanel (
			'wt.export.exportForm',
			'Export Form',
			vscode.ViewColumn.Active,
			{ enableScripts: true }
		);
		panel.webview.html = this._getHtmlForWebview(panel.webview, context.extensionPath);
		
		// Set up message handler for webview
		panel.webview.onDidReceiveMessage((e) => this.handleMessage(e));
		this.panel = panel;
    }
	
	// Handle messaging between this view and the form webview panel
	handleDocumentExport = handleDocumentExport;
	async handleMessage (data: Message) {
		switch (data.type) {
			// On submit message, call the document export handler and close the window
			case 'submit':
				await this.handleDocumentExport(this.workspace, data.exportInfo, this.outline);
				this.panel.dispose();
				break;
		}
	}

	// Creates an html string for the webview panel
	private _getHtmlForWebview (webview: vscode.Webview, _extensionUri: string): string {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/export/main.js`));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/reset.css`));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/vscode.css`));
		const styleIconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/webview/icons.css`));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/media/export/main.css`));

		const codiconsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@vscode/codicons/dist/codicon.css`));
		const elementsUri = webview.asWebviewUri(vscode.Uri.parse(`${this._extensionUri}/node_modules/@bendera/vscode-webview-elements/dist/bundled.js`));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		// Webview html
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
					<div id="form-container" class="form-container">
					<div class="head">Export Work</div>
					<vscode-form-container id="log-settings-form">
						<vscode-label for="output-name" class="label">Export File Name:</vscode-label>
						<vscode-form-helper>
							<p>Name of the exported file created.</p>
						</vscode-form-helper>
						<vscode-inputbox  
							id="input-export-file-name" 
							name="export-file-name" 
							class="input input-tail error"
						></vscode-inputbox>
						<vscode-label id="error-label" class="label error-label">
							Exported files cannot have any of the following characters in their names: 
							'#', '%', '&', '{', '}', '\\', '<', '>', '*', '?', '/', ' ', '$', '!', '\'', '"', ':', '@', '+', '\`', '|', '=', '.'.
						</vscode-label>
						<vscode-label for="select-ext-type" class="label">File Type:</vscode-label>
						<vscode-form-helper>
							<p>The file type format that your work will be exported as.</p>
						</vscode-form-helper>
						<vscode-single-select 
							id="select-ext-type" 
							name="select-ext-type" 
							class="select select-ext-type"
						>
							<vscode-option selected value="pdf">.pdf</vscode-option>
							<vscode-option  value="md">.md</vscode-option>
							<vscode-option  value="txt">.txt</vscode-option>
							<vscode-option  value="docx">.docx</vscode-option>
							<vscode-option  value="html">.html</vscode-option>
						</vscode-single-select>
						<div class="spacer"></div>
						<vscode-label for="combine-fragments-on" class="label">Fragment Glue:</vscode-label>
						<vscode-form-helper>
							<p>Specifies the string that you would like to join that fragments of each chapter with.  This is the string that will be inserted between each fragment of each chapter when the fragments are stitched together.  Default is a newline.</p>
						</vscode-form-helper>
						<vscode-inputbox
							id="input-combine-fragments-on" 
							name="combine-fragments-on" 
							class="input input-tail"
						></vscode-inputbox>
						<vscode-label for="checkbox-separate-chapter" class="label">Separate Chapters?</vscode-label>
						<vscode-checkbox 
							label="Indicates that you want to separate the export of this work into separate files, one chapter per file"
							id="checkbox-separate-chapter" 
							name="separate-chapter" 
							class="checkbox"
						></vscode-checkbox>
						<div class="spacer"></div>
						<vscode-label class="label">Export:</vscode-label>
						<vscode-button id="export-button">Export Your Work</vscode-button>
					</vscode-form-container>
					</div>
					<script src="${elementsUri}" nonce="${nonce}" type="module"></script>
					<script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
			</html>`;
	}
}