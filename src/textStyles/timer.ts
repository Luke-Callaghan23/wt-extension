
import * as vscode from 'vscode';
import * as extension from '../extension';
import * as console from '../vsconsole';
import { TextStyles } from './textStyles';

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
    'italics': /\*/g,                                   // italics
    'bold': /\^/g,                                        // bold
    'underline': /_/g,                                   // underline
    'strikethrough': /~/g,                               // strikethrough
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

export async function update (this: TextStyles, editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
    
    // To prevent from triple tilde "~~~" being matched as open/close/open tilde,
    //      we'll replace all instances of "~~~" with a junk string that won't be matched
    // Junk string must be the same length as the replace string to keep everything aligned,
    //      however
    const text = editor.document.getText()
        .replaceAll("~~~", "@@@")

        // Also allow for escaping text style characters by replacing with the same junk string
        .replaceAll(/\\\*|\\^|\\~|\\_/g, "@@");

    Object.entries(stylePatterns).forEach(([ s, pattern ]) => {
        const style = s as WordStyles;
        const decorations = styleDecorations[style];

        // Find the indeces of the current pattern in the text
        const matchIndeces = [...text.matchAll(pattern)].map(({ index }) => index!);

        // Filter out any index of any style pattern that falls inside of a comment
        const uncommentedIndeces = matchIndeces.filter(idx => {
            const position = editor.document.positionAt(idx);
            return undefined === commentedRanges.find(commentedRange => {
                if (commentedRange.contains(position)) {
                    return commentedRange;
                }
            })
        });

        if (uncommentedIndeces.length % 2 !== 0) {
            // Whenever there is an uneven amount of matches for the pattern, then the last 'opening' pattern symbol will
            //      extend to the end of the document
            uncommentedIndeces.push(text.length - 1);
        }

        // Pair each of the indeces into 2-index groups
        const pairs: [number, number][] = [];
        for (let index = 0; index < uncommentedIndeces.length - 1; index += 2) {
            pairs.push([uncommentedIndeces[index], uncommentedIndeces[index + 1]]);
        }

        // Create ranges
        const ranges = pairs.map(([ start, end ]) => {
            return new vscode.Range(editor.document.positionAt(start), editor.document.positionAt(end + 1));
        })

        // Set the decorations for the decoration type
        editor.setDecorations(decorations, ranges);
    });
}

export async function disable(this: TextStyles): Promise<void> {
    [
        italicsDecoration,
        boldDecoration,
        underlineDecoration,
        strikethroughDecoration,
    ].forEach(dec => {
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(dec, []);
        }
    })
}