import * as vscode from 'vscode';

const accents: { [index: string]: string } = {
    'é': 'É',
    'ê': 'Ê',
    'ç': 'Ç',
    'â': 'Â',
    'î': 'Î',
    'ô': 'Ô',
    'û': 'Û',
    'à': 'À',
    'è': 'È',
    'ì': 'Ì',
    'ò': 'Ò',
    'ù': 'Ù',
    'ë': 'Ë',
    'ï': 'Ï',
    'ü': 'Ü'
};

export async function addAccent (): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    if (!document) return;

    const lowercaseAccent = await vscode.window.showQuickPick(Object.keys(accents), {
        canPickMany: false,
        ignoreFocusOut: false,
        placeHolder: 'ç',
        title: "Which accent?"
    });
    if (!lowercaseAccent) return;

    const casing: 'Lowercase' | 'Capital' | undefined = await vscode.window.showQuickPick([ 'Lowercase', 'Capital' ], {
        canPickMany: false,
        ignoreFocusOut: false,
        placeHolder: "Lowercase",
        title: "Lowercase or Capital?"
    }) as 'Lowercase' | 'Capital' | undefined;
    if (!casing) return;
    
    const insert = casing === 'Lowercase'
        ? lowercaseAccent
        : accents[lowercaseAccent];

    for (const selection of editor.selections) {
        await editor.edit(eb => eb.replace(selection, insert));
    }
}
