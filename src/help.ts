import * as vscode from 'vscode';

export type PromptOptions = {
    placeholder: string,
    prompt: string
};

export async function prompt (options: PromptOptions): Promise<string> {
    let response: string|undefined;
    while (!response) {
        response = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            placeHolder: options.placeholder,
            prompt: options.prompt,
        });
    }
    return response;
}

export type QuickPickOptions = {
    prompt: string,
    placeholder: string,
    options: string[],
};

export async function quickPickPrompt (options: QuickPickOptions): Promise<string> {
	const result = await vscode.window.showQuickPick(options.options, {
		placeHolder: options.placeholder,
        ignoreFocusOut: true,
        title: options.prompt,
	});

    if (!result) {
        throw new Error("Not possible.");
    }

    return result;
}

export type ConfigFileInfoExpanded = {
    title: string,
    ordering: number,
    fileName: string
};

export type ConfigFileInfo = {
    title: string,
    ordering: number
};

export function getLatestOrdering (configData: { [index: string]: ConfigFileInfo }): number {
    let max = -1;
    Object.getOwnPropertyNames(configData).filter(name => name !== 'self').forEach(name => {
        const info = configData[name];
        if (info.ordering > max) {
            max = info.ordering;
        }
    });
    return max;
}

export async function readDotConfig (path: vscode.Uri): Promise<{ [index: string]: ConfigFileInfo } | null> {
    try {
        const dotConfigJSON = (await vscode.workspace.fs.readFile(path)).toString();
        const dotConfig: { [index: string]: ConfigFileInfo } = JSON.parse(dotConfigJSON);
        return dotConfig;
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error reading .config file '${path}': ${e}`);
        return null;
    }
}

export async function writeDotConfig (path: vscode.Uri, dotConfig: { [index: string]: ConfigFileInfo }) {
    try {
        const dotConfigJSON = JSON.stringify(dotConfig);
        await vscode.workspace.fs.writeFile(path, Buffer.from(dotConfigJSON, 'utf-8'));
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error writing .config file '${path}': ${e}`);
        return null;
    }
}


export function getNonce () {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}