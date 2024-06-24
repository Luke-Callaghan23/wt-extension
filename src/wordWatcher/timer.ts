
import * as vscode from 'vscode';
import * as extension from './../extension';
import * as console from './../vsconsole';
import { WordEnrty, WordWatcher } from './wordWatcher';
import { clamp, hexToRgb } from '../help';
import { addWordToWatchedWords } from './engine';
import { TimedView } from '../timedView';
import { Color, parseForColor } from './colorPick';
import { Workspace } from '../workspace/workspaceClass';

const defaultDecorations: vscode.DecorationRenderOptions = {
    // borderWidth: '1px',
    // borderRadius: '3px',
    // borderStyle: 'solid',
    overviewRulerColor: 'rgb(8, 161, 8)',
    // backgroundColor: 'rgb(8, 161, 8)',
    color: 'rgb(8, 161, 8)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};


// Decoration for watched words
export const defaultWatchedWordDecoration = vscode.window.createTextEditorDecorationType(defaultDecorations);

export type ColorEntry = {
    rgbaString: string,
    decoratorsIndex: number
};

export async function update (this: WordWatcher, editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
    let watchedAndEnabled: string[];
    let regexString: string;
    let regex: RegExp;
    let unwatchedRegeces: RegExp[];
    let watchedRegeces: {uri: string, reg: RegExp }[];

    if (this.wasUpdated || !this.lastCalculatedRegeces) {
        
        // Filter out the disabled words from the main watched array
        const watchedAndEnabledTmp = this.watchedWords.filter(watched => !this.disabledWatchedWords.find(disabled => watched === disabled));
        if (watchedAndEnabledTmp.length === 0) {
            watchedAndEnabled = [];
            regexString = 'a^';
            regex = /a^/gi;
            unwatchedRegeces = [/a^/gi];
            watchedRegeces = [];
        }
        else {
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
    }
    else {
        watchedAndEnabled = this.lastCalculatedRegeces.watchedAndEnabled;
        regexString = this.lastCalculatedRegeces.regexString;
        regex = this.lastCalculatedRegeces.regex;
        unwatchedRegeces = this.lastCalculatedRegeces.unwatchedRegeces;
        watchedRegeces = this.lastCalculatedRegeces.watchedRegeces;
    }
    this.wasUpdated = false;

    // Clear all old decorations first
    this.allDecorationTypes.forEach(dec => {
        editor.setDecorations(dec, []);
    });

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

        
        const isCommented = commentedRanges.find(cr => {
            if (cr.contains(startPos)) {
                return cr;
            }
        });
        if (isCommented !== undefined) continue;
        
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
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(dec, []);
        }
    })
}

const DEFAULT_ALPHA = 0.3;

const defaultColor = "rgb(8, 161, 8)";
const defaultColorObj: Color = {
    a: 1,
    b: 8,
    r: 8,
    g: 161
};
export async function changeColor(this: WordWatcher, word: WordEnrty) {
    const colorMap = this.wordColors[word.uri];
    const currentColor: string = (colorMap || { rgbaString: defaultColor }).rgbaString;
    const currentColorObj = parseForColor(currentColor) || defaultColorObj;

    const updateColor = (color: Color, confirm: boolean) => {
        // Create a new decorator options for the selected color
        const decoratorType = createDecorationType(color);
        const index = this.allDecorationTypes.length;
        this.allDecorationTypes.push(decoratorType);
    
        // Insert a color entry into the color map
        const rgbaString = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`
        const insert: ColorEntry = { rgbaString: rgbaString, decoratorsIndex: index };
        this.wordColors[word.uri] = insert;
    
        // Update context
        const context = convertWordColorsToContextItem(this.wordColors);
        this.context.workspaceState.update('wt.wordWatcher.rgbaColors', context);
        if (confirm) Workspace.packageContextItems();
    
        for (const editor of vscode.window.visibleTextEditors) {
            this.update(editor, TimedView.findCommentedRanges(editor));
        }
    }

    const wordRegex = new RegExp(word.uri);

    let exampleWord: string;
    while (true) {
        const response: string | undefined = await vscode.window.showInputBox({
            ignoreFocusOut: false,
            placeHolder: word.uri,
            title: "Example Word",
            prompt: "Please provide an example word that passes this passes this regex so you can see the colors in action... (For instance: WW='[\w]+ly', you enter='quickly'"
        });
        if (!response) return;

        if (!wordRegex.test(response)) {
            vscode.window.showErrorMessage(`'${response}' did not pass the regex '${word.uri}', please try again!`);
            continue;
        }
        exampleWord = response;
        break;
    }

    type Response = 'Yes, use last color' | 'No, keep choosing' | 'Yes, keep choosing' | 'Yes, use new color' | 'No, keep choosing' | 'Quit';

    while (true) {
        let latestColor: Color | null = null;
        const colorsHistory: Color[] = [];
        for await (const color of this.colorPick(word.uri, exampleWord, currentColor)) {
            latestColor = color;
            if (color === null) continue;
    
            const result = color;
            colorsHistory.push(result);
            updateColor(result, false);
        }
    
        let response: Response;
        if (latestColor === null) {
            if (colorsHistory.length > 0) {
                response = await vscode.window.showInformationMessage("Use latest color instead?", {
                    modal: true,
                    detail: `Latest color could not be parsed, would you like to use the latest color '${colorsHistory[colorsHistory.length - 1]}' instead?`
                }, 'Yes, use last color', 'No, keep choosing') || 'Quit';
                
            }
            else {
                // Reload
                response = await vscode.window.showInformationMessage("Try again", {
                    modal: true,
                    detail: `No colors could be parsed.  Would you like to keep picking?`
                }, 'Yes, keep choosing') || 'Quit';
            }
        }
        else {
            // confirm use latest color
            response = await vscode.window.showInformationMessage("Confirm", {
                modal: true,
                detail: `Are you sure you want to swap ${currentColor} for ${latestColor}?`
            }, 'Yes, use new color', 'No, keep choosing') || 'Quit';
        }

        switch (response) {
            case "No, keep choosing": case "Yes, keep choosing": 
                break;
            case "Quit": {
                updateColor(currentColorObj, true);
                return;
            }
            case "Yes, use last color": {
                let chosen: Color = colorsHistory[colorsHistory.length - 1];
                updateColor(chosen, true);
                return;
            }
            case "Yes, use new color": {
                let chosen: Color = latestColor!;
                updateColor(chosen, true);
                return;
            }
        }
    }
}

export function createDecorationType (color: Color): vscode.TextEditorDecorationType {
    const colorString = `rgb(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
    return createDecorationFromRgbString(colorString);
}

export function createDecorationFromRgbString (colorString: string): vscode.TextEditorDecorationType {
    const newDecoration: vscode.DecorationRenderOptions = { ...defaultDecorations };
    newDecoration.overviewRulerColor = colorString;
    newDecoration.color = colorString;
    
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