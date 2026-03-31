import * as vscode from 'vscode';
import { stripDiacritics } from '../miscTools/help';

const accentsList: Record<string, string[]> = {
    "A": ["À", "Á", "Â", "Ã", "Ä", "Å", "Ā", "Ă", "Ą", "Ǎ", "Ȁ", "Ȃ", "Ả", "Ấ", "Ầ", "Ẩ", "Ẫ", "Ậ", "Ắ", "Ằ", "Ẳ", "Ẵ", "Ặ"],
    "AE": ["Æ"],
    "C": ["Ç", "Ć", "Ĉ", "Ċ", "Č"],
    "D": ["Ð", "Ď", "Đ"],
    "E": ["È", "É", "Ê", "Ë", "Ē", "Ĕ", "Ė", "Ę", "Ě", "Ȅ", "Ȇ", "Ẹ", "Ẻ", "Ẽ", "Ế", "Ề", "Ể", "Ễ", "Ệ"],
    "G": ["Ĝ", "Ğ", "Ġ", "Ģ"],
    "H": ["Ĥ", "Ħ"],
    "I": ["Ì", "Í", "Î", "Ï", "Ĩ", "Ī", "Ĭ", "Į", "İ", "Ǐ", "Ȉ", "Ȋ", "Ỉ", "Ị"],
    "J": ["Ĵ"],
    "K": ["Ķ"],
    "L": ["Ĺ", "Ļ", "Ľ", "Ŀ", "Ł"],
    "N": ["Ñ", "Ń", "Ņ", "Ň", "Ŋ"],
    "O": ["Ò", "Ó", "Ô", "Õ", "Ö", "Ø", "Ō", "Ŏ", "Ő", "Ǒ", "Ȍ", "Ȏ", "Ọ", "Ỏ", "Ố", "Ồ", "Ổ", "Ỗ", "Ộ", "Ớ", "Ờ", "Ở", "Ỡ", "Ợ"],
    "OE": ["Œ"],
    "R": ["Ŕ", "Ŗ", "Ř"],
    "S": ["Ś", "Ŝ", "Ş", "Š"],
    "T": ["Ţ", "Ť", "Ŧ"],
    "U": ["Ù", "Ú", "Û", "Ü", "Ũ", "Ū", "Ŭ", "Ů", "Ű", "Ų", "Ǔ", "Ȕ", "Ȗ", "Ụ", "Ủ", "Ứ", "Ừ", "Ử", "Ữ", "Ự"],
    "W": ["Ŵ"],
    "Y": ["Ý", "Ŷ", "Ÿ"],
    "Z": ["Ź", "Ż", "Ž"],
    "a": ["à", "á", "â", "ã", "ä", "å", "ā", "ă", "ą", "ǎ", "ȁ", "ȃ", "ả", "ấ", "ầ", "ẩ", "ẫ", "ậ", "ắ", "ằ", "ẳ", "ẵ", "ặ"],
    "ae": ["æ"],
    "c": ["ç", "ć", "ĉ", "ċ", "č"],
    "d": ["ð", "ď", "đ"],
    "e": ["è", "é", "ê", "ë", "ē", "ĕ", "ė", "ę", "ě", "ȅ", "ȇ", "ẹ", "ẻ", "ẽ", "ế", "ề", "ể", "ễ", "ệ"],
    "g": ["ĝ", "ğ", "ġ", "ģ"],
    "h": ["ĥ", "ħ"],
    "i": ["ì", "í", "î", "ï", "ĩ", "ī", "ĭ", "į", "ǐ", "ȉ", "ȋ", "ỉ", "ị"],
    "j": ["ĵ"],
    "k": ["ķ"],
    "l": ["ĺ", "ļ", "ľ", "ŀ", "ł"],
    "n": ["ñ", "ń", "ņ", "ň", "ŋ"],
    "o": ["ò", "ó", "ô", "õ", "ö", "ø", "ō", "ŏ", "ő", "ǒ", "ȍ", "ȏ", "ọ", "ỏ", "ố", "ồ", "ổ", "ỗ", "ộ", "ớ", "ờ", "ở", "ỡ", "ợ"],
    "oe": ["œ"],
    "r": ["ŕ", "ŗ", "ř"],
    "s": ["ś", "ŝ", "ş", "š", "ß"],
    "t": ["ţ", "ť", "ŧ"],
    "u": ["ù", "ú", "û", "ü", "ũ", "ū", "ŭ", "ů", "ű", "ų", "ǔ", "ȕ", "ȗ", "ụ", "ủ", "ứ", "ừ", "ử", "ữ", "ự"],
    "w": ["ŵ"],
    "y": ["ý", "ÿ", "ŷ"],
    "z": ["ź", "ż", "ž"],
    "th": ["þ"],
    "ss": ["ß"]
};


interface SelectUnaccented extends vscode.QuickPickItem {
    type: 'selectUnaccented',
    label: string,
    options: string[]
}

interface SelectAccent extends vscode.QuickPickItem {
    type: 'selectAccent',
    label: string,
}

interface SelectCapitalization extends vscode.QuickPickItem {
    type: 'selectCapitalization',
    label: string,
}


export class Accents {
    private defaultSelections: SelectUnaccented[];
    private accentSelections: Record<string, SelectAccent[]>;

    constructor (private context: vscode.ExtensionContext) {
        this.defaultSelections = [];
        const covered: Set<string> = new Set<string>();
        for (const unaccented of Object.keys(accentsList)) {
            if (covered.has(unaccented)) {
                continue;
            }
        
            if (unaccented.toUpperCase() === unaccented && unaccented.toLowerCase() in accentsList) {
                const menuSelection: SelectUnaccented = {
                    type: 'selectUnaccented',
                    label: `${unaccented} (${unaccented.toLowerCase()})`,
                    description: `${unaccented}, ${unaccented.toLowerCase()}`,
                    options: [ unaccented, unaccented.toLowerCase() ]
                };
                covered.add(unaccented);
                covered.add(unaccented.toLowerCase());
                this.defaultSelections.push(menuSelection);
            }
            else {
                const menuSelection: SelectUnaccented = {
                    type: 'selectUnaccented',
                    label: `${unaccented}`,
                    options: [ unaccented ]
                };
                covered.add(unaccented);
                this.defaultSelections.push(menuSelection);
            }
        }

        this.accentSelections = {};
        for (const [ unaccented, accents ] of Object.entries(accentsList)) {
            this.accentSelections[unaccented] = accents.map(accentedChar => ({
                type: 'selectAccent',
                label: accentedChar,
                description: unaccented
            }))
        }
    }

    async addAccent () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        if (!document) return;

        for (let selection of editor.selections) {
            let selectionText: string | null = null;
            if (!selection.isEmpty) {
                selectionText = stripDiacritics(editor.document.getText(selection));
                if (selectionText.length === 1 || selectionText.length === 2) {
                    if (!(selectionText in accentsList)) {
                        selectionText = null;
                    }
                }
                else {
                    selectionText = null;
                }
            }
            else {
                const newSelection = new vscode.Selection(selection.start, new vscode.Position(selection.start.line, selection.start.character + 1));
                const newSelectionText = stripDiacritics(editor.document.getText(newSelection));
                if (newSelectionText in accentsList) {
                    selectionText = newSelectionText;
                    selection = newSelection;
                }
            }

            type Title = 'Select an accent' | 'Select a character with an accent' | 'Lowercase or Capital?';

            let currentSelections: (SelectUnaccented | SelectAccent)[];
            let title: Title;
            if (selectionText !== null) {
                currentSelections = this.accentSelections[selectionText];
                title = 'Select an accent';
            }
            else {
                currentSelections = this.defaultSelections;
                title = 'Select a character with an accent';
            }
            
            const qp = vscode.window.createQuickPick<SelectUnaccented | SelectAccent | SelectCapitalization>();
            qp.items = currentSelections;
            qp.matchOnDescription = true;
            qp.canSelectMany = false;
            qp.matchOnDetail = true;
            qp.placeholder = '';
            qp.value = selectionText || '';
            qp.title = title;
            qp.selectedItems = [];
            qp.keepScrollPosition = true;
            qp.ignoreFocusOut = false;
            qp.busy = false;
            qp.enabled = true;
            qp.show();
            this.context.subscriptions.push(qp);

            this.context.subscriptions.push(qp.onDidChangeValue(newValue => {
                if (newValue in this.accentSelections) {
                    qp.items = this.accentSelections[newValue];
                    qp.title = 'Select an accent' as Title;
                }
                else {
                    qp.items = this.defaultSelections;
                    qp.title = 'Select a character with an accent' as Title;
                }
            }));

            this.context.subscriptions.push(qp.onDidAccept(() => {
                
                const item = qp.selectedItems[0];
                if (item.type === 'selectAccent') {
                    editor.edit(eb => eb.replace(selection, item.label));
                    qp.dispose();
                }
                else if (item.type === 'selectUnaccented') {
                    if (item.options.length > 1) {
                        qp.items = item.options.map(option => ({
                            type: 'selectCapitalization',
                            label: option
                        }));
                        qp.value = '';
                        qp.title = 'Lowercase or Capital?' as Title;
                    }
                    else {
                        qp.items = this.accentSelections[item.options[0]];
                        qp.value = item.options[0];
                        qp.title = 'Select an accent' as Title;
                    }
                }
                else if (item.type === 'selectCapitalization') {
                    qp.items = this.accentSelections[item.label];
                    qp.value = '';
                    qp.title = 'Select an accent' as Title;
                }
            }));
        }
    }
}
