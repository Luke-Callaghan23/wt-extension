import * as vscode from 'vscode';
import * as console from '../miscTools/vsconsole';
import * as extension from './../extension';
import { OutlineView } from '../outline/outlineView';
import * as vscodeUri from 'vscode-uri';
import { ChapterNode, ContainerNode, FragmentNode, OutlineNode, RootNode, SnipNode } from '../outline/nodes_impl/outlineNode';
import { v4 as uuidv4 } from 'uuid';
import { defaultProgress } from '../miscTools/help';

export class WordCount {
    wordCountStatus: vscode.StatusBarItem;
    constructor (private context: vscode.ExtensionContext) {
        this.wordCountStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
        this.wordCountStatus.command = 'wt.wordCount.showWordCountRules';

        const updateWordCountHook = (document: vscode.TextDocument) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.fsPath !== document.uri.fsPath) {
                return;
            }
            this.updateWordCountStatusBar(document);
        }

        this.context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(updateWordCountHook));
        this.context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(updateWordCountHook));
        this.context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => updateWordCountHook(e.textEditor.document)));
        this.context.subscriptions.push(this.wordCountStatus);
        
        // Set the initial value for the word count
        const currentDoc = vscode.window.activeTextEditor?.document;
        if (currentDoc) {
            this.updateWordCountStatusBar(currentDoc);
        }
        this.registerCommands();
    }

    public static nonAlphanumeric = /[^a-zA-Z0-9]+/g;
    private updateWordCountStatusBar (document: vscode.TextDocument) {
        const fullText = document.getText();

        const editor = vscode.window.activeTextEditor;

        // Condition for selected text -- do the same word split as below, exclusively on the 
        //      selected text area
        let selectedCount: number | undefined = undefined;
        if (editor && !editor.selection.isEmpty) {
            const selectedWords = document.getText(editor.selection)
            selectedCount = this.countWordsInText(selectedWords);
        }

        // Get the word count of the document by splitting on non-alphanumeric characters
        //      (greedy) and count the split array length
        const fullWordCount = this.countWordsInText(fullText);
        this.wordCountStatus.text = `Word Count: ${fullWordCount}${selectedCount !== undefined ? ` (${selectedCount} selected)` : ''}`;
        this.wordCountStatus.show();
    }

    private countWordsInText (text: string): number {
        return text.split(WordCount.nonAlphanumeric)
            .filter(str => str.length !== 0)
            .filter(str => (/\s*/.test(str)))
            .length;
    }
    
    private async getFullWordCounts (outlineView: OutlineView) {

        type FragmentDisplay = {
            name: string;
            uri: vscode.Uri;
            wordCount: number;
        }

        type DisplayInfo = {
            kind: 'chapter' | 'snip';
            uri: vscode.Uri;
            wordCount: number;
            name: string;
            breakdown: FragmentDisplay[]
        }


        // Function to process the display info if a single text data fragment
        const processFragment = async (fragment: FragmentNode): Promise<FragmentDisplay> => {
            const uri = fragment.ids.uri;
            const name = fragment.ids.display;
            const textBuffer = await vscode.workspace.fs.readFile(uri);
            const text = extension.decoder.decode(textBuffer);
            const wordCount = this.countWordsInText(text);
            return { uri, name, wordCount };
        }


        // Function to process the display info of a single container of fragments (chapter or a snip)
        const processContainer = async (kind: 'chapter' | 'snip', name: string, uri: vscode.Uri, fragments: FragmentNode[]): Promise<DisplayInfo> => {
            const fragmentDisplayInfo: FragmentDisplay[] = await Promise.all(fragments.map(frag => processFragment(frag)));
            const totalWordCount = fragmentDisplayInfo.reduce((acc, currentFragment) => {
                return acc + currentFragment.wordCount;
            }, 0)

            return {
                kind, name, uri,
                wordCount: totalWordCount,
                breakdown: fragmentDisplayInfo                
            };
        }


        return defaultProgress("Collecting file word counts", async () => {
            const promises: Promise<DisplayInfo>[] = [];
            const root: RootNode = outlineView.rootNodes[0].data as RootNode;
            
            // Create promises to collect display data for all existing chapters
            const chapters: ContainerNode = root.chapters.data as ContainerNode;
            for (const chapterWrapper of chapters.contents) {
                const chapter = chapterWrapper.data as ChapterNode;
                const fragments: FragmentNode[] = chapter.textData.map(fragmentWrapper => fragmentWrapper.data as FragmentNode);
                promises.push(processContainer('chapter', chapter.ids.display, chapter.ids.uri, fragments));
            }
            
            // Create promises to collect display data for all existing work snips
            const workSnips: ContainerNode = root.snips.data as ContainerNode;
            for (const workSnipWrapper of workSnips.contents) {
                const snip = workSnipWrapper.data as SnipNode;
                const fragments: FragmentNode[] = snip.contents.map(fragmentWrapper => fragmentWrapper.data as FragmentNode);
                promises.push(processContainer('snip', snip.ids.display, snip.ids.uri, fragments));
            }
    
            // Wait for all fragments to be processed
            const displayData = await Promise.all(promises);
    
            // Get word count statistics
            const chaptersDisplay = displayData.filter(dd => dd.kind === 'chapter');
            const chaptersWordCount = chaptersDisplay.reduce((acc, current) => {
                return acc + current.wordCount;
            }, 0);
    
            const snipsDisplay = displayData.filter(dd => dd.kind === 'snip');        
            const snipsWordCount = snipsDisplay.reduce((acc, current) => {
                return acc + current.wordCount;
            }, 0);
            
            const totalWordCount = chaptersWordCount + snipsWordCount;
    
            // Format data in markdown
            const processContainerMD = (container: DisplayInfo) => {
                const fragmentsMD = container.breakdown.map(fragment => {
                    return `    - '${fragment.name}' (${fragment.wordCount} words)`;
                }).join('\n');
                return `  - '${container.name}' (${container.wordCount} words)\n${fragmentsMD}`;
            };
    
            const chaptersMD = chaptersDisplay.map(processContainerMD).join('\n');
            const snipsMD = snipsDisplay.map(processContainerMD).join('\n');
    
            const md = `# Total Word Count: ${totalWordCount}\n- Chapters Word Count: ${chaptersWordCount}\n${chaptersMD}\n- Work Snips Word Count: ${snipsWordCount}\n${snipsMD}`;
            const mdBuffer = extension.encoder.encode(md);
    
            // Create a 'tmp' folder for storing the markdown
            const tmpFolderPath = vscodeUri.Utils.joinPath(extension.rootPath, 'tmp');
            await vscode.workspace.fs.createDirectory(tmpFolderPath);
    
            // Create a file with the markdown data inside of it
            const tmpFilePath = vscodeUri.Utils.joinPath(tmpFolderPath, `${uuidv4()}.md`);
            vscode.workspace.fs.writeFile(tmpFilePath, mdBuffer);
    
            // Open a markdown preview for this content
            await vscode.commands.executeCommand("markdown.showPreview", tmpFilePath);
        })
    }
    

    private registerCommands () {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordCount.showWordCountRules', () => {
            vscode.window.showInformationMessage(
                "Word Count Rules",
                {
                    modal: true,
                    detail: "Word count gets updated on every save to prevent redundancy.  Rules for a what is counted as a word is simple.  Every segment of alphanumeric text that is delimited by non-alphanumeric text is considered a word."
                }
            )
        }));
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.wordCount.showFullWordCounts', async () => {
            const outlineView: OutlineView = extension.ExtensionGlobals.outlineView;
            this.getFullWordCounts(outlineView);
        }));
    } 
}