
import * as vscode from 'vscode';
import * as extension from '../extension';
import * as console from '../vsconsole';

const italicsDecorationOptions: vscode.DecorationRenderOptions = {
    fontStyle: 'italic',
    overviewRulerColor: 'rgb(161, 8, 8, 0.3)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};

const boldDecorationOptions: vscode.DecorationRenderOptions = {
    fontWeight: 'bold',
    overviewRulerColor: 'rgb(161, 8, 8, 0.3)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};

const underlineDecorationOptions: vscode.DecorationRenderOptions = {
    textDecoration: 'underline',
    overviewRulerColor: 'rgb(161, 8, 8, 0.3)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};

const strikethroughDecorationOptions: vscode.DecorationRenderOptions = {
    textDecoration: 'line-through',
    overviewRulerColor: 'rgb(161, 8, 8, 0.3)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
};

// Decoration for watched words
const italicsDecoration = vscode.window.createTextEditorDecorationType(italicsDecorationOptions);
const boldDecoration = vscode.window.createTextEditorDecorationType(boldDecorationOptions);
const underlineDecoration = vscode.window.createTextEditorDecorationType(underlineDecorationOptions);
const strikethroughDecoration = vscode.window.createTextEditorDecorationType(strikethroughDecorationOptions);

type WordStyles = 'italics' | 'bold' | 'underline' | 'strikethrough';

// Pattern for text that can be stylized
const stylePatterns: { [key in WordStyles]: RegExp } = {
    'italics': /\*[^*]*\*/ ,                                   // italics
    'bold': /#[^#]*#/ ,                                        // bold
    'underline': /_[^_]*_/ ,                                   // underline
    'strikethrough': /~[^~]*~/ ,                               // strikethrough
};

const styleDecorations = {
    'italics': italicsDecoration,                              // italics
    'bold': boldDecoration,                                    // bold
    'underline': underlineDecoration,                          // underline
    'strikethrough': strikethroughDecoration,                  // strikethrough
}

// Add all text styles to corresponding groups for matching
const styleGroups: string[] = Object.entries(stylePatterns).map(([ _, pattern ], index) => {
    return `(?<index${index}>${pattern.source})`;
});

// Create the regex string from all the style patterns
// Combine all style groups on the regex OR operator
const mainRegex = styleGroups.join(`|`);
const regex: RegExp = new RegExp(mainRegex, 'gi');

export async function update (this: WordWatcher, editor: vscode.TextEditor): Promise<void> {
        

    const text = editor.document.getText();
    
    // While there are more matches within the text of the document, collect the match selection
    const decorations: {
        styleId: WordStyles,
        decorator: vscode.TextEditorDecorationType,
        locations:  vscode.DecorationOptions[]
    }[] = []

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
        const matchReal: RegExpExecArray = match;

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
            range: new vscode.Range(startPos, endPos)
        };
        
        const styleId: WordStyles | undefined = Object.entries(stylePatterns).map(([ styleId, styleReg ]) => styleReg.test(matchReal[0]) ? styleId : []).flat()[0] as WordStyles | undefined;
        if (!styleId) continue;

        // Check if this decorator type has been found yet
        const decoration = decorations.find(dec => dec.styleId === styleId);
        if (decoration) {
            decoration.locations.push(decorationOptions);
        }
        else {
            // If not, then create it
            decorations.push({
                styleId: styleId,
                decorator: styleDecorations[styleId],
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
    [
        italicsDecoration,
        boldDecoration,
        underlineDecoration,
        strikethroughDecoration,
    ].forEach(dec => {
        vscode.window.activeTextEditor?.setDecorations(dec, []);
    })
}