// Web replacement for `platformFeatures.ts`; desktop-only features are simply absent.
import * as vscode from 'vscode';
import { Workspace } from './workspace/workspaceClass';
import { OutlineView } from './outline/outlineView';
import { OutlineNode } from './outline/nodes_impl/outlineNode';

export function initPlatformEarly (context: vscode.ExtensionContext): void {}

export function activatePlatformFeatures (context: vscode.ExtensionContext, workspace: Workspace, outlineView: OutlineView): void {}

export function isCodeMode (): boolean {
    return false;
}

export async function writeFileOnShutdown (uri: vscode.Uri, contents: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(contents));
}

export async function handleImportDrops (
    outlineView: OutlineView,
    target: OutlineNode | undefined,
    targ: OutlineNode,
    dataTransfer: vscode.DataTransfer,
): Promise<boolean> {
    return false;
}
