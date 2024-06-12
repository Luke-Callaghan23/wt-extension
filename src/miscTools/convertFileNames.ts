import * as vscode from 'vscode';
import { OutlineView } from '../outline/outlineView';

export async function convertFileNames () {
    const outlineView: OutlineView | null = await vscode.commands.executeCommand("wt.outline.getOutline");
    if (!outlineView) return;

    
}