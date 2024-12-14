import * as vscode from 'vscode';
import { Timed } from '../timedView';
import { Workspace } from '../workspace/workspaceClass';
import { PersonalDictionary } from '../intellisense/spellcheck/personalDictionary';
import { Packageable } from '../packageable';
import { DiskContextType } from '../workspace/workspace';
import { getAllIndices, vagueNodeSearch } from '../miscTools/help';
import { ExtensionGlobals } from '../extension';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';

const UNDERLINE_TIMER = 20 * 1000; // ms

type UriFileName = string;
type IncorrectWord = string;
type CorrectedWord = string;
type UndelineIdentifier = string;
type HowMany = number;

export class Autocorrect implements Timed, Packageable, vscode.CodeActionProvider<vscode.CodeAction> {
    private static BlueUnderline: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        overviewRulerColor: 'royalblue',
        borderStyle: 'none none dashed none',
        borderColor: 'royalblue',
    });

    private corrections: { [index: IncorrectWord]: CorrectedWord };
    private dontCorrect: { [index: IncorrectWord]: CorrectedWord[] };
    private exclusions:  { [index: UriFileName]: {
        [index: IncorrectWord]: HowMany;            // Tells us how many times we should ignore 
    } };

    private diagnosticCollection: vscode.DiagnosticCollection;

    // Use the file name as the main identifier for files -- as we want to maintain this
    //      collection even when files are moved
    private allCorrections: { [index: UriFileName]: {
        [index: UndelineIdentifier]: {
            range: vscode.Range;
            original: string; 
            corrected: string;
            active: boolean;
            nodeLabel: string;
        }
    } } = {};

    async askToCorrect (original: string, correction: string) {
        if (!this.enabled) return;
        original = original.toLocaleLowerCase();

        // Do not ask again if the user has already denied autocorrecting for this (word, correction) combination beforeprod
        if (this.dontCorrect[original]?.find(word => word === correction)) {
            return;
        }

        type Response = 'Yes' | 'No' | 'Stop Asking!!!';
        const response: Response | undefined  = await vscode.window.showInformationMessage(
            `Save as auto-correction?  You just updated '${original}' to '${correction}'.  Would you like to save this mapping as an auto-correction so that every time you type '${original}' it automatically gets replaced with '${correction}'?`, 
            "Yes", "No", "Stop Asking!!!"
        );
        if (response !== 'Yes') {
            if (response === 'Stop Asking!!!') {
                this.enabled = false;
            }
            if (this.dontCorrect[original]) {
                this.dontCorrect[original].push(correction);
            }
            else {
                this.dontCorrect[original] = [ correction ];
            }
            Workspace.updateContext(this.context, "wt.autocorrections.dontCorrect", this.dontCorrect);
            return;
        }
        this.corrections[original] = correction;
        Workspace.updateContext(this.context, "wt.autocorrections.corrections", this.corrections);
    }


    async tryCorrection (original: string, editor: vscode.TextEditor, range: vscode.Range): Promise<boolean> {
        const replacement = this.corrections[original];
        if (!replacement) return false;
        if (!this.enabled) return false;

        if (this.exclusions[editor.document.fileName]?.[original]) {
            const instancesOfOriginal = getAllIndices(editor.document.getText(), original);
            for (let index = 0; index < instancesOfOriginal.length; index++) {
                const instanceStartIndex = instancesOfOriginal[index];
                if (instanceStartIndex === editor.document.offsetAt(range.start)) {
                    if (index < this.exclusions[editor.document.fileName][original]) {
                        return false;
                    }
                }
            }
        }

        const success = await editor.edit((eb) => {
            eb.replace(range, replacement);
        });
        if (!success) return false;
        
        // Can't use original range because the replacement word may not be the same size as the original word
        // The replacement range is used for blue underline so it needs to fit under the replaced word
        const replacedRange = new vscode.Range(
            range.start,
            new vscode.Position(range.start.line, range.start.character + replacement.length)
        );
        
        const fileName = editor.document.fileName;

        const id = Math.random().toString(); 
        if (!this.allCorrections[fileName]) {
            this.allCorrections[fileName] = {};
        }
        

        // Query for the node representing this document to get its label
        // Label is used in the diagnostic to show where it came from
        let label: string;
        const { node: nodeOrNote, source } = await vagueNodeSearch(editor.document.uri, ExtensionGlobals.outlineView, ExtensionGlobals.recyclingBinView, ExtensionGlobals.scratchPadView, ExtensionGlobals.workBible);
        if (!nodeOrNote || !source) {
            label = editor.document.fileName;
        }
        else {
            const node: { data: { ids: { display: string } } } = nodeOrNote instanceof OutlineNode ?
                nodeOrNote : { data: { ids: { display: nodeOrNote!.noun } } };
            label = node.data.ids.display;
        }

        this.allCorrections[fileName][id] = {
            active: true,
            corrected: replacement,
            original: original,
            range: replacedRange,
            nodeLabel: label
        };

        setTimeout(() => {
            // After the under line timer elapses, remove the underline and set `active` to false
            this.allCorrections[fileName][id].active = false;

            // If a visible text editor exists for this document, then update it to remove the blue
            //      underline visually
            for (const visible of vscode.window.visibleTextEditors) {
                if (visible.document.uri.fsPath === editor.document.uri.fsPath) {
                    this.update(visible, []);
                    break;
                }
            }
        }, UNDERLINE_TIMER);
        this.update(editor, [])
        return true;
    }

    private wordExcluded (original: string, fileName: string, range: vscode.Range) {
        if (this.exclusions[fileName]) {
            if (this.exclusions[fileName][original]) {
                this.exclusions[fileName][original]++;
            }
            else {
                this.exclusions[fileName][original] = 1;
            }
        }
        else {
            this.exclusions[fileName] = {
                [original]: 1
            };
        }
        Workspace.updateContext(this.context, "wt.autocorrections.exclusions", this.exclusions);
    }
    
    private stopCorrecting (original: string): any {
        delete this.corrections[original];
        Workspace.updateContext(this.context, "wt.autocorrections.corrections", this.corrections);
    }
    
    enabled: boolean;
    async update (editor: vscode.TextEditor, commentedRanges: vscode.Range[]): Promise<void> {
        let diagnostics : vscode.Diagnostic[] = [];
        const results = editor.setDecorations(Autocorrect.BlueUnderline,  Object.entries(this.allCorrections).map(([ filename, corrections ]) => {
            if (filename !== editor.document.fileName) return [];
            return Object.entries(corrections).map(([ _, data ]) => {
                if (!data.active) return [];

                diagnostics.push(new vscode.Diagnostic(data.range, 
                    `Corrected ${data.original} to ${data.corrected} in '${data.nodeLabel}'`,
                    vscode.DiagnosticSeverity.Information
                ));
                
                return data.range;
            }).flat();
        }).flat());
        this.diagnosticCollection.set(editor.document.uri, diagnostics);
        return results;
    }

    getPackageItems(): Partial<DiskContextType> {
        return {
            "wt.autocorrections.exclusions": this.exclusions,
            "wt.autocorrections.corrections": this.corrections,
            "wt.autocorrections.dontCorrect": this.dontCorrect,
        }
    }

    registerCommands () {
        vscode.commands.registerCommand('wt.autocorrections.wordReplaced', (word: string, correction: string) => this.askToCorrect(word, correction));
        vscode.commands.registerCommand('wt.autocorrections.wordExcluded', (original: string, fileName: string, range: vscode.Range) => this.wordExcluded(original, fileName, range));
        vscode.commands.registerCommand('wt.autocorrections.stopCorrecting', (original: string) => this.stopCorrecting(original));
    }

    constructor (
        private context: vscode.ExtensionContext,
        private workspace: Workspace
    ) {
        this.enabled = true;
        this.corrections = this.context.workspaceState.get<DiskContextType['wt.autocorrections.corrections']>('wt.autocorrections.corrections') || {};
        this.dontCorrect = this.context.workspaceState.get<DiskContextType['wt.autocorrections.dontCorrect']>('wt.autocorrections.dontCorrect') || {};
        this.exclusions = this.context.workspaceState.get<DiskContextType['wt.autocorrections.exclusions']>('wt.autocorrections.exclusions') || {};
        this.registerCommands();

        vscode.languages.registerCodeActionsProvider(
            <vscode.DocumentFilter>{
                language: 'wt'
            }, this
        );

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection("stuff");
    }

    // recieve 

    provideCodeActions(
        document: vscode.TextDocument, 
        range: vscode.Range | vscode.Selection, 
        context: vscode.CodeActionContext, token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        return Object.entries(this.allCorrections).map(([ fileName, corrections ]) => {
            if (document.fileName !== fileName) return []
            return Object.entries(corrections).map(([ _, data ]) => {
                if (!range.intersection(data.range)) return [];

                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, data.range, data.original);

                return [
                    <vscode.CodeAction>{
                        title: `Corrected from '${data.original}'`,
                        isPreferred: true,
                        kind: vscode.CodeActionKind.QuickFix,
                    },
                    <vscode.CodeAction>{
                        title: `Revert this correction`,
                        command: {
                            command: "wt.autocorrections.wordExcluded",
                            arguments: [ data.original, fileName, data.range ]
                        },
                        edit: edit,
                        isPreferred: true,
                        kind: vscode.CodeActionKind.QuickFix,
                    },
                    <vscode.CodeAction>{
                        title: `Stop correcting ${data.original} -> ${data.corrected}`,
                        command: {
                            command: "wt.autocorrections.stopCorrecting",
                            arguments: [ data.original, fileName, data.range ]
                        },
                        edit: edit,
                        isPreferred: true,
                        kind: vscode.CodeActionKind.QuickFix,
                    }
                ]
            }).flat();
        }).flat();
    }
}