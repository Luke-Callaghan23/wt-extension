import * as say from 'say';
import * as vscode from 'vscode';
import * as console from '../vsconsole';

const getVoice = (): string | undefined =>
    vscode.workspace.getConfiguration('wt.speech').get<string>('voice');

const getSpeed = (): number | undefined =>
    vscode.workspace.getConfiguration('wt.speech').get<number>('speed');


export const stopSpeaking = () => {
    say.stop();
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

export const speakText = async (text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        text = cleanText(text);
        if (text.length <= 0) {
            resolve();
            return;
        }
        say.speak(text, getVoice(), getSpeed() || 1.05, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
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
