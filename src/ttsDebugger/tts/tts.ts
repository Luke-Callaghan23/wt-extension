import * as vscode from 'vscode';
import * as console from '../../miscTools/vsconsole';
import { WindowsSpeak, WordMarker } from './windows';

const windowsSpeak = new WindowsSpeak();

const getVoice = (): string | null =>
    vscode.workspace.getConfiguration('wt.speech').get<string>('voice') || null;

const getSpeed = (): number | null =>
    vscode.workspace.getConfiguration('wt.speech').get<number>('speed') || null;


export const stopSpeaking = (): Promise<void> => {
    return windowsSpeak.stop();
}

const substitutions: { [index: string]: string} = {
    '_': ' ',
    '--': ' '
};

const cleanText = (text: string): string => {
    text = text.trim();
    for (let [pattern, replacement] of Object.entries(substitutions)) {
        //@ts-ignore
        text = text.replaceAll(pattern, replacement);
    }
    return text;
}

export const speakText = async (text: string, onWord?: (wordMarker: WordMarker)=>void): Promise<void> => {
    text = cleanText(text);
    if (text.length <= 0) {
        return;
    }
    await windowsSpeak.speak(text, getVoice(), getSpeed() || 1.05, onWord);
};

const speakCurrentSelection = (editor: vscode.TextEditor) => {
    const selection = editor.selection;
    if (!selection)
        return;

    speakText(editor.document.getText(selection));
};

const speakDocument = (editor: vscode.TextEditor) => {
    speakText(editor.document.getText());
};


export function activateSpeak(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('wt.speech.speakDocument', (editor) => {
        stopSpeaking();
        if (!editor)
            return;
        speakDocument(editor);
    }));

    context.subscriptions.push(vscode.commands.registerTextEditorCommand('wt.speech.speakSelection', (editor) => {
        stopSpeaking();
        if (!editor)
            return;
        speakCurrentSelection(editor);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('wt.speech.stopSpeaking', () => {
        stopSpeaking();
    }));
}
