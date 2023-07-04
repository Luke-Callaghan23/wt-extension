
import * as vscode from 'vscode';
import * as extension from './../extension';
import * as console from './../vsconsole';
import { WordEnrty, WordWatcher } from './wordWatcher';
import { hexToRgb } from '../help';

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
    color: string,
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

const defaultColor = "#a10808";
export async function changeColor(this: WordWatcher, word: WordEnrty) {
    const colorMap = this.wordColors[word.uri];
    const currentColor = (colorMap || { color: defaultColor }).color;

    // Read the user's rgb response
    let hexResult: string;
    let result: { r: number, g: number, b: number };
    while (true) {
        const newColor = await vscode.window.showInputBox({
            ignoreFocusOut: false,
            prompt: `Enter the hex code of the color you want to highlight this watched word with`,
            title: `Enter the hex code of the color you want to highlight this watched word with`,
            value: currentColor,
            placeHolder: currentColor,
            valueSelection: [ 0, currentColor.length ]
        });
        if (!newColor) return;

        // Try parsing the color with an extra hastag or without
        const rgb = hexToRgb(newColor);
        if (!rgb) {
            vscode.window.showErrorMessage(`Could not parse '${newColor}' as a hex string.  Please try again.  Or hit escape to quit.`);
            continue;
        }
        result = rgb;
        hexResult = newColor;
        break;
    }

    // Create a new decorator options for the selected color
    const decoratorType = createDecorationType(result);
    const index = this.allDecorationTypes.length;
    this.allDecorationTypes.push(decoratorType);

    // Insert a color entry into the color map
    const insert: ColorEntry = { color: hexResult, decoratorsIndex: index };
    insert.color = hexResult;
    this.wordColors[word.uri] = insert;

    // Update context
    const context = convertWordColorsToContextItem(this.wordColors);
    this.context.workspaceState.update('wt.wordWatcher.colors', context);


    if (vscode.window.activeTextEditor) {
        this.update(vscode.window.activeTextEditor);
    }
}


export function createDecorationType (color: { r: number, g: number, b: number }): vscode.TextEditorDecorationType {
    const colorString = `rgb(${color.r}, ${color.g}, ${color.b}, 0.3)`
    const newDecoration: vscode.DecorationRenderOptions = { ...defaultDecorations };
    newDecoration.overviewRulerColor = colorString;
    newDecoration.backgroundColor = colorString;
    newDecoration.borderColor = colorString;
    
    // Register the new decoration type
    return vscode.window.createTextEditorDecorationType(newDecoration);
}

export function convertWordColorsToContextItem(wordColors: { [index: string]: ColorEntry }): { [index: string]: string } {
    const context: { [index: string]: string } = {};
    Object.entries(wordColors).forEach(([ watched, { color } ]) => {
        context[watched] = color;
    });
    return context;
}