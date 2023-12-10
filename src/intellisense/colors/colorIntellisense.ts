import * as vscode from 'vscode';
import * as console from '../../vsconsole';
import * as extension from '../../extension';
import { WordRange, capitalize, getHoverText, getHoveredWord } from '../common';
import { Workspace } from '../../workspace/workspaceClass';
import { Timed } from '../../timedView';
import { ColorGroups } from '../colors/colorGroups';
import { ColorActionProvider } from './colorActionProvider';

export type ColorInfo = {
    groupName: string,
    group: string[],
    range: vscode.Range
};

export class ColorIntellisense implements Timed {
    enabled: boolean;

    
    private static ColorMarker: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        borderStyle: 'none none solid none',
		borderWidth: '3px',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
        borderColor: '#a8325a',
		overviewRulerColor: '#a8325a',
    });


    async update (editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        const stops = /[\.\?,\s\;'":\(\)\{\}\[\]\/\\\-!\*_]/g;

        const document = editor.document;
        if (!document) return;

        const decorations: vscode.DecorationOptions[] = [];

        this.colorLocations = [];

        const fullText: string = document.getText();
        const visible: vscode.Range[] = [ ...editor.visibleRanges ];
        for (const { start: visibleStart, end: visibleEnd } of visible) {
            const textStartOff = document.offsetAt(visibleStart);
            const textEndOff = document.offsetAt(visibleEnd);
            const text: string = fullText.substring(textStartOff, textEndOff);
            const verily: WordRange[] = [];
    
            // Iterate over all (but the last) word in the document
            //      and all those words to the word ranges array
            let startOff: number;
            let endOff: number = textStartOff - 1;
            let match: RegExpExecArray | null;
            while ((match = stops.exec(text)) !== null) {
                startOff = endOff + 1;
                const matchReal: RegExpExecArray = match;
                endOff = matchReal.index + textStartOff;
                
                const start = document.positionAt(startOff);
                const end = document.positionAt(endOff);
                if (Math.abs(startOff - endOff) <= 1) continue;

                const isCommented = commentedRanges.find(cr => {
                    if (cr.contains(start)) {
                        return cr;
                    }
                });
                if (isCommented !== undefined) continue;
                
                const word = fullText.substring(startOff, endOff).toLocaleLowerCase();
                const group = this.colorGroups.getColorGroup(word);
                if (!group) continue;

                const colorRange = new vscode.Range(start, end);
                decorations.push(<vscode.DecorationOptions> {
                    range: colorRange,
                    renderOptions: ColorIntellisense.ColorMarker
                });
                this.colorLocations.push({
                    groupName: group.leader,
                    group: group.group,
                    range: colorRange,
                });
            }

        }
        // Set all red underlines
        editor.setDecorations(ColorIntellisense.ColorMarker, decorations);
    }

    // 
    async disable? (): Promise<void> {
        // Simply clear all four of the proximity decorators
        if (!vscode.window.activeTextEditor) return;
        const editor = vscode.window.activeTextEditor;
        editor.setDecorations(ColorIntellisense.ColorMarker, []);
    }


    private colorLocations: ColorInfo[] | undefined;
    getColorLocations (): ColorInfo[] {
        return this.colorLocations || [];
    }

    constructor (
        private context: vscode.ExtensionContext,
        workspace: Workspace,
        private colorGroups: ColorGroups
    ) {
        this.enabled = true;
        const wtSelector: vscode.DocumentFilter = <vscode.DocumentFilter>{
            language: 'wt'
        };
        vscode.languages.registerCodeActionsProvider(wtSelector, new ColorActionProvider(context, workspace, this));
    }
}