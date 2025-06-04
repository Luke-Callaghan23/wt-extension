import * as vscode from 'vscode';
import * as vscodeUri from 'vscode-uri';
import { Timed } from '../timedView';
import { DiskContextType, Workspace } from '../workspace/workspaceClass';
import { PersonalDictionary } from '../intellisense/spellcheck/personalDictionary';
import { Packageable } from '../packageable';
import { getAllIndices, vagueNodeSearch } from '../miscTools/help';
import { ExtensionGlobals } from '../extension';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
export const commonReplacements = {
    '”': '"',
    '“': '"',
    '‘': "'",
    '’': "'",
    '‛': "'",
    '‟': '"',
    '…': '...',
    '—': ' -- ',
    '–': ' -- ',
    '­': '',
    ' ': ' ',
};

const UNDERLINE_TIMER = 20 * 1000; // ms

type UriFileName = string;
type IncorrectWord = string;
type CorrectedWord = string;
type UnderlineIdentifier = string;
type HowMany = number;

type CorrectionKind = 'correction' | 'specialCharacterSwap';

export class Autocorrect implements Timed, Packageable<"wt.autocorrections.exclusions" | "wt.autocorrections.corrections" | "wt.autocorrections.dontCorrect">, vscode.CodeActionProvider<vscode.CodeAction> {
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
    private replacementsRegex: RegExp;

    private diagnosticCollection: vscode.DiagnosticCollection;

    // Use the file name as the main identifier for files -- as we want to maintain this
    //      collection even when files are moved
    private allCorrections: { [index: UriFileName]: {
        [index: UnderlineIdentifier]: {
            kind: CorrectionKind
            range: vscode.Range;
            original: string; 
            corrected: string;
            active: boolean;
            nodeLabel: string;
        }
    } } = {};

    private notificationActive: boolean = false;
    async askToCorrect (original: string, correction: string) {
        if (!this.enabled) return;
        original = original.toLocaleLowerCase();

        // Do not ask again if the user has already denied autocorrecting for this (word, correction) combination beforeprod
        if (this.dontCorrect[original]?.find(word => word === correction)) {
            return;
        }

        type Response = 'Yes' | 'No' | 'Stop Asking!!!';

        const notificationPromise = vscode.window.showInformationMessage(
            `Save as auto-correction?  You just updated '${original}' to '${correction}'.  Would you like to save this mapping as an auto-correction so that every time you type '${original}' it automatically gets replaced with '${correction}'? (ctrl+shift+A to accept, ctrl+shift+x to reject) * (cmd on Mac) * (Please only use these commands when this is the only active notification)`, 
            "Yes", "No", "Stop Asking!!!"
        );

        this.notificationActive = true;
        const response: Response | undefined  = await notificationPromise;
        this.notificationActive = false;

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


    private async createUnderliner (uri: vscode.Uri, original: string, replacement: string, replacedRange: vscode.Range, correctionKind: CorrectionKind='correction') {

        const fileName = vscodeUri.Utils.basename(uri);

        // Query for the node representing this document to get its label
        // Label is used in the diagnostic to show where it came from
        let label: string;
        const { node: nodeOrNote, source } = await vagueNodeSearch(uri);
        if (!nodeOrNote || !source) {
            label = fileName;
        }
        else {
            const node: { data: { ids: { display: string } } } = nodeOrNote instanceof OutlineNode ?
                nodeOrNote : { data: { ids: { display: nodeOrNote!.title } } };
            label = node.data.ids.display;
        }
        
        const id = Math.random().toString(); 
        if (!this.allCorrections[fileName]) {
            this.allCorrections[fileName] = {};
        }
        
        this.allCorrections[fileName][id] = {
            kind: correctionKind,
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
                if (visible.document.uri.fsPath === uri.fsPath) {
                    this.update(visible, []);
                    break;
                }
            }
        }, UNDERLINE_TIMER);
    }

    async tryCorrection (original: string, editor: vscode.TextEditor, range: vscode.Range): Promise<boolean> {
        const replacement = this.corrections[original];
        if (!replacement) return false;
        if (!this.enabled) return false;

        const documentFileName = vscodeUri.Utils.basename(editor.document.uri);
        if (this.exclusions[documentFileName]?.[original]) {
            const instancesOfOriginal = getAllIndices(editor.document.getText(), original);
            for (let index = 0; index < instancesOfOriginal.length; index++) {
                const instanceStartIndex = instancesOfOriginal[index];
                if (instanceStartIndex === editor.document.offsetAt(range.start)) {
                    if (index < this.exclusions[documentFileName][original]) {
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
        this.createUnderliner(
            editor.document.uri, 
            original, replacement, 
            replacedRange,

        );

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

        const docText = editor.document.getText();
        
        const specialCharacterEdits: [ vscode.Range, CorrectedWord ][] = [];

        let m: RegExpExecArray | null;
        while ((m = this.replacementsRegex.exec(docText)) !== null) {
            const original = m[0];
            const replacement = commonReplacements[m[0] as keyof typeof commonReplacements];
            const specialCharacterRange = new vscode.Range(
                editor.document.positionAt(m.index),
                editor.document.positionAt(m.index + original.length)
            );
            specialCharacterEdits.push([ specialCharacterRange, replacement ]);

            // KNOWN ISSUE:
            // Multiple autocorrections on the same line where one of the corrections
            //      is ' -- ' will result in this `replacementRange` appear
            //      visually incorrect with the blue underline
            const replacementRange = new vscode.Range(
                editor.document.positionAt(m.index),
                editor.document.positionAt(m.index + replacement.length)
            );

            this.createUnderliner(
                editor.document.uri, 
                original, replacement, 
                replacementRange, 
                'specialCharacterSwap'
            );
        }

        if (specialCharacterEdits.length > 0) {
            editor.edit(eb => {
                for (const [ range, replacement ] of specialCharacterEdits) {
                    eb.replace(range, replacement);
                }
            });
        }
        
        let diagnostics : vscode.Diagnostic[] = [];
        const results = editor.setDecorations(Autocorrect.BlueUnderline,  Object.entries(this.allCorrections).map(([ filename, corrections ]) => {
            if (filename !== vscodeUri.Utils.basename(editor.document.uri)) return [];
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

    getPackageItems() {
        return {
            "wt.autocorrections.exclusions": this.exclusions,
            "wt.autocorrections.corrections": this.corrections,
            "wt.autocorrections.dontCorrect": this.dontCorrect,
        }
    }

    registerCommands () {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.autocorrections.wordReplaced', (word: string, correction: string) => this.askToCorrect(word, correction)));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.autocorrections.wordExcluded', (original: string, fileName: string, range: vscode.Range) => this.wordExcluded(original, fileName, range)));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.autocorrections.stopCorrecting', (original: string) => this.stopCorrecting(original)));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.autocorrections.acceptAutocorrect', async () => {
            if (!this.notificationActive) return;
            await vscode.commands.executeCommand('notifications.focusFirstToast');
            return vscode.commands.executeCommand('notification.acceptPrimaryAction');
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.autocorrections.rejectAutocorrect', async () => {
            if (!this.notificationActive) {
                // Do the default behavior for ctrl+shift+x
                // Hacky workaround, but I don't believe there is any default way to force this keybinding to fall through
                return vscode.commands.executeCommand('workbench.view.extensions');
            }
            return vscode.commands.executeCommand('notifications.clearAll');
        }));
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

        this.context.subscriptions.push(vscode.languages.registerCodeActionsProvider(
            <vscode.DocumentFilter>{
                language: 'wt'
            }, this
        ));

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection("stuff");
        this.replacementsRegex = new RegExp(`(${Object.keys(commonReplacements).join("|")})`, 'g');
        this.context.subscriptions.push(Autocorrect.BlueUnderline);
        this.context.subscriptions.push(this.diagnosticCollection);
    }

    getUpdatesAreVisible(): boolean {
        return true;
    }

    // recieve 

    provideCodeActions(
        document: vscode.TextDocument, 
        range: vscode.Range | vscode.Selection, 
        context: vscode.CodeActionContext, token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        return Object.entries(this.allCorrections).map(([ fileName, corrections ]) => {
            if (vscodeUri.Utils.basename(document.uri) !== fileName) return []
            return Object.entries(corrections).map(([ _, data ]) => {
                if (data.kind === 'specialCharacterSwap' || !range.intersection(data.range)) return [];

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