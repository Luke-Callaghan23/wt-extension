import * as vscode from 'vscode';
import { WordWatcher } from './wordWatcher';
import * as extension from './../extension';
import { getUsableFileName } from '../outline/impl/createNodes';
import { compareFsPath } from '../help';


export type Color = { r: number, g: number, b: number, a: number };
export async function* colorPick (
    this: WordWatcher, 
    word: string, 
    exampleWord: string,
    initialColor: string,
): AsyncGenerator<Color | null> {
    const colorPickContent = `/* 

Change the color here, then CLOSE THE DOCUMENT when you are finished.

NOTE: whenever this document is closed, the color here will be the selected color, but you will have the opportunity to cancel if you're not satisfied

NOTE: please don't edit anything in this document besides the color.  You'll probably break something.

*/









.word {
    color: ${initialColor};
}`;


    const tmpFolder = vscode.Uri.joinPath(extension.rootPath, 'tmp');
    try {
        await vscode.workspace.fs.createDirectory(tmpFolder);
    }
    catch (err: any) {}

    const colorPickFN = `${getUsableFileName('colorPick')}.css`;
    const colorPickerDocUri = vscode.Uri.joinPath(extension.rootPath, 'tmp', colorPickFN);
    const contentBuff = extension.encoder.encode(colorPickContent);
    await vscode.workspace.fs.writeFile(colorPickerDocUri, contentBuff);

    const exampleSentence = `Here is an example sentence with your example word ${exampleWord} inside of it so you can see how ${exampleWord} would look in normal text.  Wow!`
    const exampleSentenceFN = getUsableFileName('fragment', true);
    const exampleSentenceUri = vscode.Uri.joinPath(extension.rootPath, 'tmp', exampleSentenceFN);
    const exampleSentenceBuff = extension.encoder.encode(exampleSentence);
    await vscode.workspace.fs.writeFile(exampleSentenceUri, exampleSentenceBuff);

    await vscode.window.showTextDocument(exampleSentenceUri, {
        preview: false,
        viewColumn: vscode.ViewColumn.One
    });

    await vscode.window.showTextDocument(colorPickerDocUri, {
        preview: false,
        selection: new vscode.Selection(new vscode.Position(19, 11), new vscode.Position(19, initialColor.length)),
        viewColumn: vscode.ViewColumn.Beside
    });
    await vscode.commands.executeCommand('editor.action.showOrFocusStandaloneColorPicker');


    let stop = false;
    while (!stop) {
        yield await new Promise<Color | null>(async (accept, reject) => {
            const dispose1 = vscode.workspace.onDidCloseTextDocument(async e => {
                dispose1.dispose();
                dispose2.dispose();
                const uri = e.uri.fsPath.replaceAll(".git", "");
                if (uri !== colorPickerDocUri.fsPath) return;
                const buf = await vscode.workspace.fs.readFile(colorPickerDocUri);
                const content = extension.decoder.decode(buf);
                const color = parseForColor(content);
                stop = true;
                if (!color) {
                    vscode.window.showErrorMessage("Could not parse color from text file.  Please try again (don't edit the css file too much, please).");
                    accept(null);
                }
                else {
                    for (const group of vscode.window.tabGroups.all) {
                        const ind = group.tabs.findIndex(tab => {
                            return tab.input instanceof vscode.TabInputText && compareFsPath(tab.input.uri, exampleSentenceUri);
                        });
                        if (ind === -1) continue;
                        const tab = group.tabs[ind];
                        vscode.window.tabGroups.close(tab).then(reject, reject);
                        break;
                    }
                    accept(color)
                }
            });
            const dispose2 = vscode.workspace.onDidSaveTextDocument(async e => {
                dispose1.dispose();
                dispose2.dispose();
                const uri = e.uri.fsPath.replaceAll(".git", "");
                if (uri !== colorPickerDocUri.fsPath) return;
                const buf = await vscode.workspace.fs.readFile(colorPickerDocUri);
                const content = extension.decoder.decode(buf);
                const color = parseForColor(content);
                if (!color) {
                    vscode.window.showErrorMessage("Could not parse color from text file.  Please try again (don't edit the css file too much, please).");
                }
                accept(color);
            });
            setTimeout(() => {
                dispose1.dispose();
                dispose2.dispose();
                for (const group of vscode.window.tabGroups.all) {
                    const ind = group.tabs.findIndex(tab => {
                        return tab.input instanceof vscode.TabInputText && (
                            compareFsPath(tab.input.uri, exampleSentenceUri) || 
                            compareFsPath(tab.input.uri, colorPickerDocUri)
                        )
                    });
                    if (ind === -1) continue;
                    const tab = group.tabs[ind];
                    vscode.window.tabGroups.close(tab);
                    break;
                }
                stop = false;
                accept(null);
            }, 5 * 60 * 1000);
        });
    }
    

    
}



export function parseForColor (css: string): Color | null {
    // Will maybe parse the css if you're really gentle
    const colorReg = /(\/\*(.|\n)*\*\/\s*.word\s*{\s*color\s*:\s*)?((?<hex>#(?<hex_r>[0-9a-fA-F][0-9a-fA-F])(?<hex_g>[0-9a-fA-F][0-9a-fA-F])(?<hex_b>[0-9a-fA-F][0-9a-fA-F])((?<hex_a>[0-9a-fA-F][0-9a-fA-F]))?)|(?<rgba>rgba?\s*\(\s*(?<rgba_r>\d\d?\d?)\s*,\s*(?<rgba_g>\d\d?\d?)\s*,\s*(?<rgba_b>\d\d?\d?)\s*,\s*(?<rgba_a>[\d\.]+)\s*\))|(?<rgb>rgb\s*\(\s*(?<rgb_r>\d\d?\d?)\s*,\s*(?<rgb_g>\d\d?\d?)\s*,\s*(?<rgb_b>\d\d?\d?)\s*\)))(\s*(;?|\n)\s*}\s*)?/;
    // You're just gonna have to trust me on this one
    
    const match: RegExpExecArray | null = colorReg.exec(css);
    if (match === null || !match.groups) {
        return null;
    }
    
    //@ts-ignore
    const groups: {
        hex: string,
        hex_r: string,
        hex_g: string,
        hex_b: string,
        hex_a: string | undefined,
    } | {
        rgba: string,
        rgba_r: string,
        rgba_g: string,
        rgba_b: string,
        rgba_a: string,
    } | {
        rgb: string,
        rgb_r: string,
        rgb_g: string,
        rgb_b: string
    } = match.groups;

    let colorObj: Color;
    if ('hex' in groups && groups['hex'] !== undefined) {
        const hex = groups.hex;
        const hexR = groups.hex_r;
        const hexG = groups.hex_g;
        const hexB = groups.hex_b;
        const hexA = groups.hex_a || 'ff';

        colorObj = {
            r: parseInt(hexR, 16),
            g: parseInt(hexG, 16),
            b: parseInt(hexB, 16),
            a: parseInt(hexA, 16) / 0xff,
        };
    }
    else if ('rgba' in groups && groups['rgba'] !== undefined) {
        const rgba = groups.rgba;
        const rgbaR = groups.rgba_r;
        const rgbaG = groups.rgba_g;
        const rgbaB = groups.rgba_b;
        const rgbaA = groups.rgba_a;

        colorObj = {
            r: parseInt(rgbaR),
            g: parseInt(rgbaG),
            b: parseInt(rgbaB),
            a: parseFloat(rgbaA),
        };
    }
    else if ('rgb' in groups && groups['rgb'] !== undefined) {
        const rgb = groups.rgb;
        const rgbR = groups.rgb_r;
        const rgbG = groups.rgb_g;
        const rgbB = groups.rgb_b;
        const rgbA = '255';

        colorObj = {
            r: parseInt(rgbR),
            g: parseInt(rgbG),
            b: parseInt(rgbB),
            a: parseFloat(rgbA) / 0xff,
        };
    }
    else return null;

    return colorObj;
}
