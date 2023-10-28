
import * as vscode from 'vscode';
import * as extension from './../extension';
import * as console from './../vsconsole';
import { WordEnrty, WordWatcher } from './wordWatcher';
import { clamp, hexToRgb } from '../help';
import { addWordToWatchedWords } from './engine';

const defaultDecorations: vscode.DecorationRenderOptions = {
    borderWidth: '1px',
    borderRadius: '3px',
    borderStyle: 'solid',
    overviewRulerColor: 'rgb(161, 8, 8, 0.3)',
    backgroundColor: 'rgb(161, 8, 8, 0.3)',
    borderColor: 'rgb(161, 8, 8, 0.3)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};


// Decoration for watched words
export const defaultWatchedWordDecoration = vscode.window.createTextEditorDecorationType(defaultDecorations);

export type ColorEntry = {
    rgbaString: string,
    decoratorsIndex: number
};

export async function update (this: WordWatcher, editor: vscode.TextEditor): Promise<void> {
    let watchedAndEnabled: string[];
    let regexString: string;
    let regex: RegExp;
    let unwatchedRegeces: RegExp[];
    let watchedRegeces: {uri: string, reg: RegExp }[];
    if (this.wasUpdated || !this.lastCalculatedRegeces) {
        
        // Filter out the disabled words from the main watched array
        const watchedAndEnabledTmp = this.watchedWords.filter(watched => !this.disabledWatchedWords.find(disabled => watched === disabled));

        // Add a mapping to the watched words array to add a named group
        watchedAndEnabled = watchedAndEnabledTmp.map((watchedRegexString, index) => {
            return `(?<index${index}>${watchedRegexString})`;
        });

        // Create the regex string from the still-enabled watched words
        // Join all the enabled watched words by a string like `wordSeparator` + `|` + `wordSeparator
        //      to add explicit 'OR' to all of the watched words ('|' semantically means OR)
        const mainRegex = watchedAndEnabled.join(`${extension.wordSeparator}|${extension.wordSeparator}`);
        // Bookend the main regex with word separators
        regexString = extension.wordSeparator + mainRegex + extension.wordSeparator;
        regex = new RegExp(regexString, 'gi');
        unwatchedRegeces = this.unwatchedWords.map(unwatched => new RegExp(`${extension.wordSeparator}${unwatched}${extension.wordSeparator}`, 'i'));
        watchedRegeces = this.watchedWords.map(watched => ({ uri: watched, reg: new RegExp(`${extension.wordSeparator}${watched}${extension.wordSeparator}`, 'i') }));

        this.lastCalculatedRegeces = {
            watchedAndEnabled,
            regexString,
            regex,
            unwatchedRegeces,
            watchedRegeces
        };
    }
    else {
        watchedAndEnabled = this.lastCalculatedRegeces.watchedAndEnabled;
        regexString = this.lastCalculatedRegeces.regexString;
        regex = this.lastCalculatedRegeces.regex;
        unwatchedRegeces = this.lastCalculatedRegeces.unwatchedRegeces;
        watchedRegeces = this.lastCalculatedRegeces.watchedRegeces;
    }
    this.wasUpdated = false;

    const text = editor.document.getText();
    
    // While there are more matches within the text of the document, collect the match selection

    const decorations: {
        colorId: string,
        decorator: vscode.TextEditorDecorationType,
        locations:  vscode.DecorationOptions[]
    }[] = []

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
        const matchReal: RegExpExecArray = match;

        let tag: string = match[0];
        const groups = matchReal.groups;
        if (groups) {
            try {
                const validGroups = Object.entries(groups).filter(([ key, val ]) => 
                    val !== undefined
                ).map(([ key, _ ]) => key);
                const matchIndexStrs = validGroups.map(group => group.replace('index', ''));
                const matchIndeces = matchIndexStrs.map(mis => parseInt(mis));
                const matchRegeces = matchIndeces.map(index => watchedAndEnabled[index]);
                const matchFmt = matchRegeces.map(match => match.replace('(?', '').replace(')', ''));
                const matches = matchFmt.join(', ');
                tag = `Matched by pattern: '**${matches}**'`;
            }
            catch (err: any) {}
        }

        // Skip if the match also matches an unwatched word
        if (unwatchedRegeces.find(re => re.test(matchReal[0]))) {
            continue;
        }

        let start: number = match.index;
        if (match.index !== 0) {
            start += 1;
        }
        let end: number = match.index + match[0].length;
        if (match.index + match[0].length !== text.length) {
            end -= 1;
        }
        const startPos = editor.document.positionAt(start);
        const endPos = editor.document.positionAt(end);
        const decorationOptions: vscode.DecorationOptions = { 
            range: new vscode.Range(startPos, endPos), 
            hoverMessage: new vscode.MarkdownString(tag)
        };
        
        const watched = watchedRegeces.find(({ reg }) => reg.test(matchReal[0]));
        if (!watched) continue;

        // Get the color id and decorator type for the watched word
        const watchedUri = watched.uri;
        const color = this.wordColors[watchedUri];
        let colorId: string;
        let decorationType: vscode.TextEditorDecorationType;
        if (!color) {
            decorationType = defaultWatchedWordDecoration;
            colorId = 'default';
        }
        else {
            const decorationsIndex = color.decoratorsIndex;
            colorId = decorationsIndex + '';
            decorationType = this.allDecorationTypes[decorationsIndex];
        }

        // Check if this decorator type has been found yet
        const decoration = decorations.find(dec => dec.colorId === colorId);
        if (decoration) {
            decoration.locations.push(decorationOptions);
        }
        else {
            // If not, then create it
            decorations.push({
                colorId: colorId,
                decorator: decorationType,
                locations: [ decorationOptions ]
            });
        }
        regex.lastIndex -= 1;
    }

    decorations.forEach(({ locations, decorator }) => {
        editor.setDecorations(decorator, locations);
    });
}

export async function disable(this: WordWatcher): Promise<void> {
    this.allDecorationTypes.forEach(dec => {
        vscode.window.activeTextEditor?.setDecorations(dec, []);
    })
}

const DEFAULT_ALPHA = 0.3;
type Rgba = {
    r: number,
    g: number, 
    b: number,
    a: number
};

const defaultColor = "rgb(161, 8, 8, 0.3)";
export async function changeColor(this: WordWatcher, word: WordEnrty) {
    const colorMap = this.wordColors[word.uri];
    const currentColor: string = (colorMap || { rgbaString: defaultColor }).rgbaString;

    // Read the user's rgb response
    let rgbaString: string;
    let result: Rgba;
    while (true) {
        const newColor = await vscode.window.showInputBox({
            ignoreFocusOut: false,
            prompt: `Enter the hex code or rgb(#, #, #, #) formatted color you would like to use:`,
            title: `Enter the hex code or rgb(#, #, #, #) formatted color you would like to use:`,
            value: currentColor,
            placeHolder: currentColor,
            valueSelection: [ 0, currentColor.length ]
        });
        if (!newColor) return;

        // Try parsing the color with an extra hastag or without

        const res = readColorFromString(newColor);
        if ('errMessage' in res) {
            vscode.window.showErrorMessage(`Could not parse '${newColor}': ${res.errMessage}`);
            continue;
        }

        result = res;
        rgbaString = `rgb(${res.r}, ${res.g}, ${res.b}, ${res.a})`;
        break;
    }

    // Create a new decorator options for the selected color
    const decoratorType = createDecorationType(result);
    const index = this.allDecorationTypes.length;
    this.allDecorationTypes.push(decoratorType);

    // Insert a color entry into the color map
    const insert: ColorEntry = { rgbaString: rgbaString, decoratorsIndex: index };
    this.wordColors[word.uri] = insert;

    // Update context
    const context = convertWordColorsToContextItem(this.wordColors);
    this.context.workspaceState.update('wt.wordWatcher.rgbaColors', context);


    if (vscode.window.activeTextEditor) {
        this.update(vscode.window.activeTextEditor);
    }
}

function readColorFromString (src: string): { errMessage: string } | Rgba {
    const rgbaRegex = /\s*rgba?\s*\(\s*(?<r>\d{1,3})\s*,\s*(?<g>\d{1,3})\s*,\s*(?<b>\d{1,3})\s*(\s*,\s*(?<a>0\.\d+)\s*)?\)\s*/gi;

    let match: RegExpExecArray | null;
    if ((match = rgbaRegex.exec(src)) !== null) {
        const groups = match.groups;
        if (groups && 'r' in groups && 'g' in groups && 'b' in groups) {
            const rgba = groups as {
                r: string,
                g: string,
                b: string,
                a?: string
            };
            const { r, g, b, a } = rgba;
            const ri = parseInt(r);
            const gi = parseInt(g);
            const bi = parseInt(b);

            if (isNaN(ri)) return { errMessage: `'r' (${r}) could not be parsed as an integer` };
            if (isNaN(gi)) return { errMessage: `'g' (${g}) could not be parsed as an integer` };
            if (isNaN(bi)) return { errMessage: `'b' (${b}) could not be parsed as an integer` };

            let ai = DEFAULT_ALPHA;
            if (a) {
                ai = parseFloat(a);
                if (isNaN(ai)) return { errMessage: `'a' (${a}) could not be parsed as an integer` };
            }

            return { 
                r: clamp(ri, 0, 255), 
                b: clamp(bi, 0, 255), 
                g: clamp(gi, 0, 255), 
                a: ai 
            };
        }
        else return { errMessage: `(rgba color error) Missing 'r', 'g', or 'b' from input'` };
    }

    const hexRegex = /\s*#(?<r>[a-f0-9]{2})(?<g>[a-f0-9]{2})(?<b>[a-f0-9]{2})(?<a>[a-f0-9]{2})?/;
    if ((match = hexRegex.exec(src)) !== null) {
        const groups = match.groups;
        if (groups && 'r' in groups && 'g' in groups && 'b' in groups) {
            const rgba = groups as {
                r: string,
                g: string,
                b: string,
                a?: string
            };
            const { r, g, b, a } = rgba;
            const ri = parseInt(r, 16);
            const gi = parseInt(g, 16);
            const bi = parseInt(b, 16);

            if (isNaN(ri)) return { errMessage: `'r' (${r}) could not be parsed as a hex integer` };
            if (isNaN(gi)) return { errMessage: `'g' (${g}) could not be parsed as a hex integer` };
            if (isNaN(bi)) return { errMessage: `'b' (${b}) could not be parsed as a hex integer` };

            let ai = DEFAULT_ALPHA;
            if (a) {
                ai = parseInt(a, 16) / 0xff;
                if (isNaN(ai)) return { errMessage: `'a' (${a}) could not be parsed as an integer` };
            }

            return { 
                r: clamp(ri, 0, 255), 
                b: clamp(bi, 0, 255), 
                g: clamp(gi, 0, 255), 
                a: ai 
            };
        }
        else return { errMessage: `(hex color error) Missing 'r', 'g', or 'b' from input'` };
    }

    return { errMessage: `Could not parse color in either color format!` };
}


export function createDecorationType (color: Rgba): vscode.TextEditorDecorationType {
    const colorString = `rgb(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
    return createDecorationFromRgbString(colorString);
}

export function createDecorationFromRgbString (colorString: string): vscode.TextEditorDecorationType {
    const newDecoration: vscode.DecorationRenderOptions = { ...defaultDecorations };
    newDecoration.overviewRulerColor = colorString;
    newDecoration.backgroundColor = colorString;
    newDecoration.borderColor = colorString;
    
    // Register the new decoration type
    return vscode.window.createTextEditorDecorationType(newDecoration);
}

export function convertWordColorsToContextItem(wordColors: { [index: string]: ColorEntry }): { [index: string]: string } {
    const context: { [index: string]: string } = {};
    Object.entries(wordColors).forEach(([ watched, { rgbaString } ]) => {
        context[watched] = rgbaString;
    });
    return context;
}

export async function changePattern (this: WordWatcher, word: WordEnrty) {
    if (word.type !== 'watchedWord') return;
    
    // Get the index of the selected watched word in the watched word in the array
    const index = this.watchedWords.findIndex(ww => {
        return ww === word.uri.toString()
    });
    if (index === -1) return;

    // Prompt the user for the new pattern
    const newPattern = await this.addWord({
        addWord: false,
        watched: true,
        placeholder: word.uri,
        value: word.uri
    });
    if (newPattern === null) return;

    // Update context and view with new pattern
    this.updateWords('replace', newPattern, 'wt.wordWatcher.watchedWords', index);
}