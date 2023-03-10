/* eslint-disable curly */
/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { ConfigFileInfo } from '../help';
import { getUsableFileName } from '../outline/createNodes';
import { OutlineView } from '../outline/outlineView';
import * as extension from '../extension';
import * as console from '../vsconsole';
import { ImportForm } from './importFormView';
import { OutlineNode } from '../outline/outlineNodes';
import * as showdown from 'showdown';
import * as mammoth from 'mammoth';
const pdf2html = require('pdf2html');
import { JSDOM } from 'jsdom';

export type DocInfo = {
    skip: boolean,
    ext: 'wt' | 'txt' | 'md' | 'html' | 'pdf' | 'docx',
    outputType: 'snip' | 'chapter',
    outputIntoChapter: boolean,
    outputSnipPath: '/data/snips/',
    outputSnipName: string,
    outputChapterName: string,
    outputChapter: string,
    shouldSplitFragments: boolean,
    outerSplitRegex: string,
    shouldSplitSnips: boolean,
    fragmentSplitRegex: string,
};

export type ImportDocumentInfo = {
    [index: string]: DocInfo
};

type NoSplit = {
    type: 'none',
    data: string
};

type SingleSplit = {
    type: 'single',
    data: string[]
};

type MultiSplit = {
    type: 'multi',
    data: string[][],
};

type DocSplit = NoSplit | SingleSplit | MultiSplit;

type SplitInfo = {
    fragmentSplitRegex: RegExp | undefined,
    outerSplitRegex: RegExp | undefined
};

function splitMd (content: string, split: SplitInfo): DocSplit | undefined {
    if (split.fragmentSplitRegex) {
        if (split.outerSplitRegex) {
            // Document split and snip split -> return a multi split
            const snipSplit = split.outerSplitRegex as RegExp;
            const fragmentSplit = split.fragmentSplitRegex as RegExp;

            // Split the content by the snip splitter regex
            const snips = content.split(snipSplit);
            // Then split each snip split above by the fragment split regex
            const data = snips.map(snip => {
                const splits = snip.split(fragmentSplit);
                const trimmed = splits.map(splt => splt.trim());
                return trimmed.filter(trim => trim.length > 0);
            });

            // Return the multisplit
            return {
                type: 'multi',
                data: data
            } as MultiSplit;
        }
        else {
            // Document split, but no snipSplit -> return a Single split
            return {
                type: 'single',
                data: content
                    .split(split.fragmentSplitRegex)
                    .map(split => split.trim())
                    .filter(trim => trim.length > 0)
            } as SingleSplit;
        }
    }
    else {
        // No document split -> return a NoSplit
        return {
            type: 'none',
            data: content
        } as NoSplit;
    }
}


const replace = {
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
};
// Replace common unicode characters in writing with more usable versions
function replaceCommonUnicode (content: string): string {
    return Object.entries(replace).reduce((acc, [ from, to ]) => {
        return acc.replaceAll(from , to);
    }, content)
}

async function readAndSplitMd (split: SplitInfo, fileRelativePath: string): Promise<DocSplit> {
    // Get the full file path and read the content of that file
    const fileUri = vscode.Uri.joinPath(extension.rootPath, fileRelativePath);
    const fileContent = (await vscode.workspace.fs.readFile(fileUri)).toString();

    // Replace some common unicode elements in the file with more friendly stuff
    const filteredContent = replaceCommonUnicode(fileContent);

    // Split the content with the split rules provided in `split`
    const splits = splitMd(filteredContent, split);
    if (!splits) {
        vscode.window.showErrorMessage(`Error ocurred when splitting markdown document`);
        throw new Error(`Error ocurred when splitting markdown document`);
    }
    return splits;
}
const readAndSplitWt = readAndSplitMd;
const readAndSplitTxt = readAndSplitMd;

async function doHtmlSplits (split: SplitInfo, htmlContent: string): Promise<DocSplit | null> {
    // Create a converter for turning the provided html into md
    const showdownConverter = new showdown.Converter({
        ellipsis: true,
        ghCodeBlocks: true,
        openLinksInNewWindow: true,
        underline: true,
        tables: true,
        emoji: true,
        simplifiedAutoLink: true,
        completeHTMLDocument: true,
        strikethrough: true,
        tasklists: true,
        
    });
    
    // Convert the html to markdown
    const convertedMd = showdownConverter.makeMarkdown(htmlContent, new JSDOM('...').window.document);

    // Showdown escapes all tildes ... we don't like that so, we take out all the escape characters
    const withoutEscapedTildes = convertedMd.replaceAll('\\~', '~');

    // Replace some common unicode elements in the file with more friendly stuff
    const filteredContent = replaceCommonUnicode(withoutEscapedTildes);

    // Split the content with the split rules provided in `split`
    const splits = splitMd(filteredContent, split);
    if (!splits) {
        vscode.window.showErrorMessage(`Error ocurred when splitting markdown document`);
        throw new Error(`Error ocurred when splitting markdown document`);
    }
    return splits;
}

async function readAndSplitHtml (split: SplitInfo, fileRelativePath: string): Promise<DocSplit | null> {
    const fileUri = vscode.Uri.joinPath(extension.rootPath, fileRelativePath);
    const fileContent: string = (await vscode.workspace.fs.readFile(fileUri)).toString();
    return doHtmlSplits(split, fileContent);
}

async function readAndSplitPdf (split: SplitInfo, fileRelativePath: string): Promise<DocSplit | null> {
    let html: string;
    try {
        const fullFilePath = vscode.Uri.joinPath(extension.rootPath, fileRelativePath);
        html = await pdf2html.html(fullFilePath);
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error ocurred when parsing html from source pdf '${fileRelativePath}': ${e}`);
        throw e;
    }

    // Remove junk from produced html
    html = html.split('</head>')[1].replace('<body><div class=\"page\"><p/>', '').replaceAll('<div class=\"page\">', '').replaceAll('</div>', '').replace('</body></html>', '');
    
    // Tell the user about the faults of this pdf to html converter
    const response = await vscode.window.showInformationMessage(`Imperfect import of PDFs`, {
        modal: true,
        detail: 'Sorry, as of right now, importing PDF files is imperfect.  Italics and bolding and other text effects will be completely lost.  If you wish to keep these, please use an online converter to turn your pdf files into docx or html or some other supported file type if you need these text effects to be preserved!'
    }, 'Continue with imperfect import');
    if (response !== 'Continue with imperfect import') return null;
    
    // Do splits on the html
    return doHtmlSplits(split, html);
}

async function readAndSplitDocx (split: SplitInfo, fileRelativePath: string): Promise<DocSplit | null> {
    let html: string;
    try {
        // Use mammoth to convert the docx to html
        const fullFilePath = vscode.Uri.joinPath(extension.rootPath, fileRelativePath);
        const result = await mammoth.convertToHtml({
            path: fullFilePath.fsPath
        }, {
            ignoreEmptyParagraphs: false,
            includeDefaultStyleMap: true
        });
    
        // Record messages if there are any
        if (result.messages.length > 0) {
            // TODO write messages
        }
        html = result.value;
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error ocurred when parsing html from source docx '${fileRelativePath}': ${e}`);
        throw e;
    }

    // Then do splits on the html
    return doHtmlSplits(split, html);
}

function getSplitInfo (doc: DocInfo): SplitInfo {
    let fragmentSplitRegex: RegExp | undefined = undefined;
    if (doc.shouldSplitFragments) {
        const fragmentSplit = doc.fragmentSplitRegex;
        try {
            fragmentSplitRegex = new RegExp(fragmentSplit);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error creating regex from provided fragment split string '${fragmentSplit}': ${e}`);
            throw e;
        }
    }

    let snipSplitRegex: RegExp | undefined = undefined;
    if (doc.shouldSplitSnips) {
        const snipSplit = doc.outerSplitRegex;
        try {
            snipSplitRegex = new RegExp(snipSplit);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error creating regex from provided snip split string '${snipSplit}': ${e}`);
            throw e;
        }
    }

    return {
        fragmentSplitRegex: doc.shouldSplitFragments ? fragmentSplitRegex : undefined,
        outerSplitRegex: doc.shouldSplitSnips ? snipSplitRegex : undefined
    };
}

// Info for importing snip(s) from a document
type SnipInfo = {
    type: 'snip',
    outputSnipName: string,
    output: {
        dest: 'chapter',
        outputChapter: string,
    } | {
        dest: 'snip'
        outputSnipPath: '/data/snips/',
    },
};

// Infor for importing a chapter from a document
type ChapterInfo = {
    type: 'chapter',
    outputChapterName: string,
};

type WriteInfo = ChapterInfo | SnipInfo;

function getWriteInfo (docInfo: DocInfo): WriteInfo {
    if (docInfo.outputType === 'chapter') {
        return {
            type: 'chapter',
            outputChapterName: docInfo.outputChapterName
        };
    }
    else if (docInfo.outputType === 'snip') {
        return {
            type: 'snip',
            output: docInfo.outputIntoChapter
                ? {
                    dest: 'chapter',
                    outputChapter: docInfo.outputChapter
                }
                : {
                    dest: 'snip',
                    outputSnipPath: "/data/snips/"
                },
            outputSnipName: docInfo.outputSnipName
        };
    }
    else {
        throw new Error('Not possible');
    }
}

async function createFragmentFromSource (
    containerUri: vscode.Uri, 
    content: string,
    config: { [index: string]: ConfigFileInfo },
    ordering: number,
): Promise<string> {
    // Create the fragment file
    const fragmentFileName = getUsableFileName('fragment', true);
    const fragmentUri = vscode.Uri.joinPath(containerUri, fragmentFileName);
    await vscode.workspace.fs.writeFile(fragmentUri, Buffer.from(content, 'utf-8'));

    // Add the record for this fragment to the config map
    config[fragmentFileName] = {
        title: `Imported Fragment (${ordering})`,
        ordering: ordering
    };

    return fragmentFileName;
}

async function writeChapter (docSplits: DocSplit, chapterInfo: ChapterInfo) {

    if (docSplits.type === 'multi') {
        // If there are multiple splits, then call write snip to write the new snips into the chapter

        // First create snip info
        for (let index = 0; index < docSplits.data.length; index++) {
            const currentChapter: ChapterInfo = {
                type: 'chapter',
                outputChapterName: `${chapterInfo.outputChapterName} ${index}`
            };
            const currentChapterFragments: DocSplit = {
                type: 'single',
                data: docSplits.data[index]
            };
            await writeChapter(currentChapterFragments, currentChapter);
        }
        return;
    }

    const outlineView: OutlineView = await vscode.commands.executeCommand('wt.outline.getOutline');
    const chapterUri: vscode.Uri | null = await outlineView.newChapter(undefined, {
        preventRefresh: false, 
        defaultName: chapterInfo.outputChapterName,
        skipFragment: true
    });
    if (!chapterUri) return;

    const dotConfig: { [index: string]: ConfigFileInfo } = {};

    if (docSplits.type === 'none') {
        // Create the single snip and store their config data inside of the dotConfig created above
        await createFragmentFromSource(chapterUri, docSplits.data, dotConfig, 0);
    }
    else if (docSplits.type === 'single') {
        // Create all snips and store their config data inside of the dotConfig created above
        let ordering = 0;
        await Promise.all(docSplits.data.map(content => {
            const promise = createFragmentFromSource(chapterUri, content, dotConfig, ordering);
            ordering++;
            return promise;
        }));
    }

    // Write the .config file to the location of the chapter folder
    const dotConfigJSON = JSON.stringify(dotConfig);
    const dotConfigUri = vscode.Uri.joinPath(chapterUri, `.config`);
    await vscode.workspace.fs.writeFile(dotConfigUri, Buffer.from(dotConfigJSON, 'utf-8'));
}

async function writeSnip (docSplits: DocSplit, snipInfo: SnipInfo) {
    const outlineView: OutlineView = await vscode.commands.executeCommand('wt.outline.getOutline');
    
    // Get the parent node where the new snip(s) should be inserted
    let parentNode: OutlineNode | undefined;
    const output = snipInfo.output;
    if (output.dest === 'snip') {
        // dest = 'snip' -> inserted snips are work snips, parent is undefined (root node)
        parentNode = undefined;
    }
    else if (output.dest === 'chapter') {
        // dest = 'chapter' -> inserted snips are inserted into the specified chapter
        // Find the chapter by its uri and use that as the parent node
        const chapterUri = vscode.Uri.joinPath(extension.rootPath, output.outputChapter);
        const chapterNode: OutlineNode = await outlineView._getTreeElementByUri(chapterUri);
        parentNode = chapterNode;
    }

    // Uploads fragments in a content array into specified path
    const fragmentUpload = async (contents: string[], snipUri: vscode.Uri) => {
        const dotConfig: { [index: string]: ConfigFileInfo } = {};

        let ordering = 0;
        await Promise.all(contents.map(content => {
            const promise = createFragmentFromSource(snipUri, content, dotConfig, ordering);
            ordering++;
            return promise;
        }));

        // Write the .config file to the location of the snip folder
        const dotConfigJSON = JSON.stringify(dotConfig);
        const dotConfigUri = vscode.Uri.joinPath(snipUri, `.config`);
        await vscode.workspace.fs.writeFile(dotConfigUri, Buffer.from(dotConfigJSON, 'utf-8'));
    };
    
    if (docSplits.type === 'multi') {
        // Create multiple snips, and load fragment data inside of each
        for (let snipOrdering = 0; snipOrdering < docSplits.data.length; snipOrdering++) {
            const snipContent = docSplits.data[snipOrdering];

            // Create current snip
            const snipName = `${snipInfo.outputSnipName} (${snipOrdering})`;
            const snipUri: vscode.Uri | null = await outlineView.newSnip(parentNode, {
                preventRefresh: true, 
                defaultName: snipName,
                skipFragment: true
            });
            if (!snipUri) return;
            
            // Upload this snip's fragments
            await fragmentUpload(snipContent, snipUri);
        }
    }
    else {
        // Create one snip, and load the document data into one fragment inside of it
        const snipUri: vscode.Uri | null = await outlineView.newSnip(parentNode, {
            preventRefresh: true, 
            defaultName: snipInfo.outputSnipName,
            skipFragment: true
        });
        if (!snipUri) return;

        const contents = docSplits.type === 'none'
            // If there are no splits, put the single content item in an array
            ? [ docSplits.data ]
            // Otherwise, use the data array from single split
            : docSplits.data;

        await fragmentUpload(contents, snipUri);
    }
}

async function writeDocumentSplits (docSplits: DocSplit, writeInfo: WriteInfo) {
    // Call the chapter/snip specific write function
    if (writeInfo.type === 'chapter') {
        await writeChapter(docSplits, writeInfo);
    }
    else if (writeInfo.type === 'snip') {
        await writeSnip(docSplits, writeInfo);
    }
}

async function importDoc (doc: DocInfo, fileRelativePath: string) {
    if (doc.skip) {
        vscode.window.showWarningMessage(`Skipping '${fileRelativePath}' . . . `);
        return;
    }

    // Get the information needed for splitting this document
    const splitInfo = getSplitInfo(doc);

    // Find the splitting (and reading) function
    let splitFunc: (split: SplitInfo, fileRelativePath: string) => Promise<DocSplit | null>;
    switch (doc.ext) {
        case 'wt': splitFunc = readAndSplitWt; break;
        case 'md': splitFunc = readAndSplitMd; break;
        case 'txt': splitFunc = readAndSplitTxt; break;
        case 'docx': splitFunc = readAndSplitDocx; break;
        case 'pdf': splitFunc = readAndSplitPdf; break;
        case 'html': splitFunc = readAndSplitHtml; break;
    }
    // Read and split the document
    const docSplit = await splitFunc(splitInfo, fileRelativePath);
    if (!docSplit) return;

    const splits: DocSplit = docSplit;

    // Create a write info struct for this write
    const writeInfo = getWriteInfo(doc);

    // Finally, write the document to the file system
    await writeDocumentSplits(splits, writeInfo);
}

export async function handleImport (this: ImportForm, docInfo: ImportDocumentInfo) {
    
    const docNames = Object.getOwnPropertyNames(docInfo);
    const docLastModified: { 
        name: string,
        lastModified: number 
    }[] = [];

    // Assign modified dates to each of the doc names provided by called
    for (const docName of docNames) {
        const doc = vscode.Uri.joinPath(extension.rootPath, docName);
        const stat = await vscode.workspace.fs.stat(doc);
        docLastModified.push({
            name: docName,
            lastModified: stat.mtime.valueOf()
        });
    }

    // Sort all doc names by the last modified date
    docLastModified.sort((a, b) => a.lastModified - b.lastModified);

    for (let index = 0; index < docNames.length; index++) {
        const docRelativePath = docNames[index];
        const doc = docInfo[docRelativePath];
        vscode.window.showInformationMessage(`Processing '${docRelativePath}' [${index + 1} of ${docNames.length}]`);
        try {
            await importDoc(doc, docRelativePath);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error occurred when importing '${docRelativePath}': ${e}`);
        }
    }
    // Refresh both the outline view and todo view to reflect changes
    vscode.commands.executeCommand('wt.outline.refresh');
    vscode.commands.executeCommand('wt.todo.refresh');
}