// Desktop (node) implementations of everything that cannot run in the web extension.
// `platformFeatures.web.ts` provides the matching no-op versions and replaces this file in the web bundle.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as vscodeUri from 'vscode-uri';
import { ImportFileSystemView } from './import/importFileSystemView';
import { CoderModer } from './codeMode/codeMode';
import { activateSpeak } from './ttsDebugger/tts/tts';
import { activateDebug } from './ttsDebugger/debugger/debugExtention';
import { ExportForm } from './export/exportFormView';
import { getRipGrepBinarySearchPromise, RipGrep } from './miscTools/grepper/ripGrep';
import { Workspace } from './workspace/workspaceClass';
import { OutlineView } from './outline/outlineView';
import { OutlineNode } from './outline/nodes_impl/outlineNode';
import { getNodeNamePath, isSubdirectory } from './miscTools/help';

let codeMode: CoderModer | undefined;
let importFileSystemView: ImportFileSystemView | undefined;

export function initPlatformEarly (context: vscode.ExtensionContext): void {
    RipGrep.init(context);
}

export function activatePlatformFeatures (context: vscode.ExtensionContext, workspace: Workspace, outlineView: OutlineView): void {
    importFileSystemView = new ImportFileSystemView(context, workspace);        // wt.import.fileSystem
    codeMode = new CoderModer(context);
    ExportForm.registerCommands(context.extensionUri, context, workspace, outlineView);

    context.subscriptions.push(vscode.commands.registerCommand("wt.wtSearch.setRipGrepLocation", async () => {
        const configuration = vscode.workspace.getConfiguration();
        const oldLocation: string | undefined = configuration.get<string>('wt.wtSearch.ripGrepLocation');

        const newLocation = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: oldLocation ? vscode.Uri.file(oldLocation) : undefined,
            openLabel: "Select",
            title: "Select 'rg' binary to use for WTANIWE searches",
        });
        if (!newLocation) return;

        const newPath = newLocation[0].fsPath;
        await configuration.update('wt.wtSearch.ripGrepLocation', newPath, vscode.ConfigurationTarget.Workspace);
        RipGrep.rgPath = getRipGrepBinarySearchPromise(context);

        vscode.window.showInformationMessage("[INFO] Successfully updated 'rg' path for WTANIWE searches!")
    }));

    activateSpeak(context);
    activateDebug(context);
}

export function isCodeMode (): boolean {
    return codeMode?.getCodeModeState() === 'codeMode';
}

// vscode.workspace.fs is already gone by the time deactivate() runs on desktop
export async function writeFileOnShutdown (uri: vscode.Uri, contents: string): Promise<void> {
    fs.writeFileSync(uri.fsPath, contents);
}

// Returns true if the drop was an import and the outline's own drop handling should be skipped
export async function handleImportDrops (
    outlineView: OutlineView,
    target: OutlineNode | undefined,
    targ: OutlineNode,
    dataTransfer: vscode.DataTransfer,
): Promise<boolean> {
    if (!importFileSystemView) return false;

    // Drops from the import file system view
    const importTreeData = dataTransfer.get('application/vnd.code.tree.import.fileexplorer');
    if (importTreeData) {
        let entries: { uri: vscode.Uri }[];
        if (typeof importTreeData.value === 'string') {
            entries = JSON.parse(importTreeData.value);
        }
        else {
            entries = importTreeData.value as { uri: vscode.Uri } [];
        }

        const uris = entries.map(({ uri }) => uri);
        importFileSystemView.importDroppedFolder(uris, {
            node: targ,
            namePath: await getNodeNamePath(targ),
            destination: targ.data.ids.type === 'chapter'
                ? 'chapter'
                : 'snip'
        });
    }

    // Drops from the outside file system
    const importUriData = dataTransfer.get('text/uri-list');
    if (importUriData) {
        const importableUris: vscode.Uri[] = [];
        const fragmentDocuments: vscode.Uri[] = [];
        
        importUriData.value.split('\n')
            .map((uriString: string) => vscode.Uri.parse(uriString.trim()))
            .forEach((uri: vscode.Uri) => {
                const ext = vscodeUri.Utils.extname(uri).replace(".", "").toLocaleLowerCase();

                // Only try to import valid file types that come from outside WTANIWE
                let keepGeneral = !(
                    isSubdirectory(outlineView.workspace.legacyChaptersFolder, uri)
                    || isSubdirectory(outlineView.workspace.chapterGroupsFolder, uri)
                    || isSubdirectory(outlineView.workspace.workSnipsFolder, uri)
                    || isSubdirectory(outlineView.workspace.scratchPadFolder, uri)
                    || isSubdirectory(outlineView.workspace.recyclingBin, uri)
                ) && outlineView.workspace.importFileTypes.includes(ext)

                if (!keepGeneral) return;

                if (ext === 'md' || ext === 'wt' || ext === 'wtnote') {
                    fragmentDocuments.push(uri);
                }
                else {
                    importableUris.push(uri);
                }
            });

        if (importableUris.length > 0) {
            await importFileSystemView.importDroppedDocuments(importableUris, target);
            return true;
        }
        if (fragmentDocuments.length > 0) {
            await importFileSystemView.importDroppedFragmentDocuments("Outline", fragmentDocuments, target);
        }
    }

    return false;
}
