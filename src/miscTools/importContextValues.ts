import * as vscode from 'vscode';
import { ExtensionGlobals, rootPath } from '../extension';
import { DiskContextType } from '../workspace/workspaceClass';
import { __ } from './help';
import { resolve } from 'path';
import { ReloadWatcher } from './reloadWatcher';

const importableContextKeys = [
    "wt.synonyms.synonyms",
    "wt.wh.synonyms",
    "wt.notebook.tree.enabled",
    "wt.todo.enabled",
    "wt.wordWatcher.enabled",
    "wt.wordWatcher.watchedWords",
    "wt.wordWatcher.disabledWatchedWords",
    "wt.wordWatcher.excludedWords",
    "wt.wordWatcher.rgbaColors",
    "wt.spellcheck.enabled",
    "wt.very.enabled",
    "wt.colors.enabled",
    "wt.colors.extraColors",
    "wt.textStyle.enabled",
    "wt.personalDictionary",
    "wt.reloadWatcher.enabled",
    "wt.autocorrections.enabled",
    "wt.autocorrections.corrections",
    "wt.autocorrections.dontCorrect"
] as const;


type ThemeIconName = string;
type ReadableDescription = string;
const importableContextValues: Record<typeof importableContextKeys[number], [ ThemeIconName, ReadableDescription ]> = {
    "wt.synonyms.synonyms"                : [ "references", "Synonyms Panel Saved Words" ],
    "wt.wh.synonyms"                      : [ "edit", "Word Hippo Panel Saved Words" ],
    "wt.notebook.tree.enabled"            : [ "jersey", "Highlighting for Notebook Aliases (enabled/disabled)" ],
    "wt.todo.enabled"                     : [ "array", "Automatic Updates to TODO Tree (enabled/disabled)" ],
    "wt.wordWatcher.enabled"              : [ "tag", "Highlighting for Word Watcher Words (enabled/disabled)" ],
    "wt.wordWatcher.watchedWords"         : [ "search", "Word Watcher Saved Words" ],
    "wt.wordWatcher.disabledWatchedWords" : [ "search-fuzzy", "Word Watcher Disabled Words (Un-Checked Words in the Word Watcher panel)" ],
    "wt.wordWatcher.excludedWords"       : [ "search-stop", "Word Watcher Excluded Words" ],
    "wt.wordWatcher.rgbaColors"           : [ "search", "Word Watcher Word Colors" ],
    "wt.spellcheck.enabled"               : [ "notebook-state-error", "Highlighting for Spellcheck (enabled/disabled)" ],
    "wt.very.enabled"                     : [ "coffee", "Highlighting for Very* Words (enabled/disabled)" ],
    "wt.colors.enabled"                   : [ "symbol-color", "Highlighting for Color Words (enabled/disabled)" ],
    "wt.colors.extraColors"               : [ "symbol-color", "Color Words Additional Colors" ],
    "wt.textStyle.enabled"                : [ "symbol-parameter", "Text Stylization (italics, bold, etc.) (enabled/disabled)" ],
    "wt.personalDictionary"               : [ "symbol-text", "Personal Dictionary Saved Words" ],
    "wt.reloadWatcher.enabled"            : [ "eye", "Automatic Detection of Changes to contextValues.json (enabled/disabled)" ],
    "wt.autocorrections.enabled"          : [ "feedback", "Autocorrect Allowed Misspelled Words (enabled/disabled)" ],
    "wt.autocorrections.corrections"      : [ "search-replace-all", "List of Allowed Autocorrections" ],
    "wt.autocorrections.dontCorrect"      : [ "breakpoints-remove-all", "List of Denied Autocorrections" ],
};

export async function importContextValuesFromFile () {

    // Have the user select a contextValues.json file
    const otherCvPath: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: vscode.Uri.joinPath(rootPath, '..', 'fotbb/data/contextValues.json'),
        title: "Select a contextValues.json file to import from",
        openLabel: "Import",
        filters: {
            "JSON": ['json']
        }
    });
    if (!otherCvPath) return;

    // Read the current and importing context values json file
    const currentCvUri = ExtensionGlobals.workspace.contextValuesFilePath;
    const [ otherCvUri ] = otherCvPath;
    let currentCv: DiskContextType;
    let otherCv: DiskContextType;
    try {
        const otherCvBuffer = await vscode.workspace.fs.readFile(otherCvUri);
        const otherCvString = otherCvBuffer.toString();
        otherCv = JSON.parse(otherCvString);

        const currentCvBuffer = await vscode.workspace.fs.readFile(currentCvUri);
        const currentCvString = currentCvBuffer.toString();
        currentCv = JSON.parse(currentCvString);
    }
    catch (err: any) {
        vscode.window.showErrorMessage(`[ERR] An error occurred while reading the contextValues.json path at '${otherCvUri.fsPath}': ${err}`);
        return;
    }

    // Choosable keys are all the keys in the other contextValues.json file that are also in `importableContextValues`
    const otherCvKeys   = Object.keys(otherCv);
    const possibleKeys  = new Set(Object.keys(importableContextValues));
    const choosableKeys = new Set(otherCvKeys.filter(otherKey => possibleKeys.has(otherKey)));

    const picks: vscode.QuickPickItem[] = importableContextKeys.map(key => {
        // If the key is not choosable, ignore it
        if (!choosableKeys.has(key)) {
            return [];
        }

        const [ themeIcon, importDescription ] = importableContextValues[key];
        return __<vscode.QuickPickItem>({
            label: importDescription,
            description: key,
            alwaysShow: true,
            iconPath: new vscode.ThemeIcon(themeIcon),
            picked: true,
        });
    }).flat();

    const selected = await vscode.window.showQuickPick(picks, {
        canPickMany: true,
        ignoreFocusOut: false,
        matchOnDescription: true,
        title: "Select which fields to import from the other contextValues.json file (NOTE: current values from this workspace will ne OVERWRITTEN!)"
    });
    if (!selected || selected.length === 0) return;

    // Update all keys from the other context values file into the current one
    const config = vscode.workspace.getConfiguration()
    await Promise.all(selected.map(select => {
        new Promise<void>(async resolve => {
            const contextKey   = select.description as keyof typeof importableContextValues;
            const contextValue = otherCv[select.description as keyof DiskContextType];
    
            //@ts-ignore
            currentCv[contextKey] = contextValue;
            await ExtensionGlobals.context.globalState.update(contextKey, contextValue);
            resolve();
        })
    }));

    await ReloadWatcher.changedContextValues(true, true, currentCv);
};