/* eslint-disable curly */
/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { __, compareFsPath, ConfigFileInfo, getNodeNamePath, getSectionedProgressReporter } from '../miscTools/help';
import { getUsableFileName, newSnip } from '../outline/impl/createNodes';
import { OutlineView } from '../outline/outlineView';
import * as extension from '../extension';
import { DroppedSourceInfo, ImportForm, Li } from './importFormView';
import { ChapterNode, OutlineNode, RootNode, ContainerNode } from '../outline/nodes_impl/outlineNode';
import * as mammoth from 'mammoth';
import { v4 as uuid } from 'uuid';
import * as TurndownService from 'turndown';

const libreofficeConvert = require('libreoffice-convert');
const util = require('util');
libreofficeConvert.convertAsync = util.promisify(libreofficeConvert.convert);

// REMOVE SQUARE BRACKETS [ AND ] FROM ESCAPE CHARACTERS
TurndownService.prototype.escape = function (string: string) {
    return [
        [/\\/g, '\\\\'],
        [/\*/g, '\\*'],
        [/^-/g, '\\-'],
        [/^\+ /g, '\\+ '],
        [/^(=+)/g, '\\$1'],
        [/^(#{1,6}) /g, '\\$1 '],
        [/`/g, '\\`'],
        [/^~~~/g, '\\~~~'],
        [/^>/g, '\\>'],
        [/_/g, '\\_'],
        [/^(\d+)\. /g, '$1\\. ']
    ].reduce(function (accumulator, escape) {
        //@ts-ignore
        return accumulator.replace(escape[0], escape[1])
    }, string)
};




import { Buff } from '../Buffer/bufferSource';
import { commonReplacements } from '../autocorrect/autocorrect';

export type DocInfo = {
    skip: boolean,
    ext: 'wt' | 'txt' | 'html' | 'docx' | 'odt' | 'md',
    outputType: 'snip' | 'chapter',
    outputIntoChapter: boolean,
    outputSnipPath: '/data/snips/',
    outputSnipName: string,
    outputChapterName: string,
    outputChapter: string,
    outputIntoDroppedSource: boolean,
    useNonGenericFragmentNames: boolean,
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

type NamedSingleSplit = {
    title: string | null; 
    data: string;
};

type NamedSnipSplit = {
    title: string | null;
    data: NamedSingleSplit[];
}

type SingleSplit = {
    type: 'single',
    data: NamedSingleSplit[];
};

type MultiSplit = {
    type: 'multi',
    data: NamedSnipSplit[],
};

type DocSplit = NoSplit | SingleSplit | MultiSplit;

type SplitInfo = {
    useNonGenericFragmentNames: boolean,
    fragmentSplitRegex: RegExp | undefined,
    outerSplitRegex: RegExp | undefined
};

const getSnipDateString = () => {
    // Make a date string for the new snip aggregate
    const date = new Date();
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are zero-based
    const year = date.getFullYear();
    const dateStr = `${month}-${day}-${year}`;
    return dateStr;
}

function splitWt (content: string, split: SplitInfo): DocSplit | undefined {

    const processTitledSplit = (splitter: RegExp, text: string, outerTitle: string | null): NamedSingleSplit[] => {
        
        let nextTitle: string | null = null;
        if (split.useNonGenericFragmentNames && outerTitle && outerTitle.length > 0) {
            nextTitle = `(${outerTitle}) Imported Fragment 0`
        }
        let cursor = 0;

        const out: NamedSingleSplit[] = [];
        
        let m: RegExpExecArray | null;
        let idx: number = 0;
        while ((m = splitter.exec(text)) !== null) {
            const match: RegExpExecArray = m;
            if (match[0].trim().includes('\n')) continue;

            const matchStart = match.index;

            // Push the previous split text into the splits array
            const prevSplitFullText = text.substring(cursor, matchStart);
            const formattedSplit = prevSplitFullText.trim();
            // Only push the snip if the snip is not empty and the title is also not empty
            if (formattedSplit.length !== 0) {
                out.push({
                    // Use the previous `nextTitle` value for the title of the current split
                    title: nextTitle, 
                    data: formattedSplit
                });
            }

            // From the substring that was matched attempt to read a title for the next split
            nextTitle = match[1] ? match[1].trim() : null;
            nextTitle = nextTitle && nextTitle.length > 0 ? nextTitle : null;

            if (split.useNonGenericFragmentNames && nextTitle === null && outerTitle && outerTitle.length > 0) {
                nextTitle = `(${outerTitle}) Imported Fragment ${idx+1}`
            }

            // And advance the cursor past the matched area
            cursor = match.index + match[0].length;
            idx++;
        }

        // Add the last split starting from the current cursor position to the end of the document
        out.push({
            title: nextTitle,
            data: text.substring(cursor, text.length).trim()
        });
        return out;
    }   

    if (split.fragmentSplitRegex) {
        if (split.outerSplitRegex) {
            // Document split and snip split -> return a multi split
            const snipSplitter = split.outerSplitRegex as RegExp;
            const fragmentSplitter = split.fragmentSplitRegex as RegExp;

            // Split the full text of the document by the snip splitter
            const snipsSplit = processTitledSplit(snipSplitter, content, null);

            // Iterate over full text data of each snip and split each of them on the fragment
            //      separator
            const fullSplit: NamedSnipSplit[] = snipsSplit.map(snip => {
                const { title: snipTitle, data } = snip;
                const fragmentsSplit = processTitledSplit(fragmentSplitter, data, snipTitle);
                return {
                    title: snipTitle,
                    data: fragmentsSplit
                }
            });

            // Return the multisplit
            return {
                type: 'multi',
                data: fullSplit
            } as MultiSplit;
        }
        else {
            // Document split, but no snipSplit -> return a Single split
            const singleSplits = processTitledSplit(split.fragmentSplitRegex, content, null);

            return {
                type: 'single',
                data: singleSplits
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


async function readAndSplitWt (split: SplitInfo, fileRelativePath: string): Promise<DocSplit> {
    // Get the full file path and read the content of that file
    const fileUri = vscode.Uri.joinPath(extension.rootPath, fileRelativePath);
    const fileContent = (await vscode.workspace.fs.readFile(fileUri)).toString();

    // Split the content with the split rules provided in `split`
    const splits = splitWt(fileContent, split);
    if (!splits) {
        vscode.window.showErrorMessage(`Error ocurred when splitting markdown document`);
        throw new Error(`Error ocurred when splitting markdown document`);
    }
    return splits;
}

async function readAndSplitMd (split: SplitInfo, fileRelativePath: string): Promise<DocSplit> {
    // Get the full file path and read the content of that file
    const fileUri = vscode.Uri.joinPath(extension.rootPath, fileRelativePath);
    const fileContent = (await vscode.workspace.fs.readFile(fileUri)).toString();

    const tmpString = uuid()
    const final = fileContent
        .replaceAll("~~~", tmpString)
        .replaceAll("**", "^")
        .replaceAll("~~", "~")
        .replaceAll(tmpString, "~~~");

    // Split the content with the split rules provided in `split`
    const splits = splitWt(final, split);
    if (!splits) {
        vscode.window.showErrorMessage(`Error ocurred when splitting markdown document`);
        throw new Error(`Error ocurred when splitting markdown document`);
    }
    return splits;
}

const readAndSplitTxt = readAndSplitWt;

async function doHtmlSplits (split: SplitInfo, htmlContent: string): Promise<DocSplit | null> {
    // Create a converter for turning the provided html into md
    const turndownService = new TurndownService({ 
        bulletListMarker: '-',
        hr: '~~~',
        emDelimiter: '*',
        blankReplacement: function(content: any) {
            return ' '; // Replace empty lines with two new lines
        }
    });

    turndownService.addRule('strikethrough', {
        //@ts-ignore
        filter: ['del', 's', 'strike' ],
        replacement: function (content: string) {
            return '~' + content + '~'
        }
    });

    turndownService.addRule('bold', {
        filter: [ 'b', 'strong' ],
        replacement: function (content: string) {
            return '^' + content + '^'
        }
    });

    turndownService.addRule('underline', {
        filter: [ 'u' ],
        replacement: function (content: string) {
            return '_' + content + '_'
        }
    });

    // Convert the html to markdown
    const convertedMd = turndownService.turndown(htmlContent);

    // Showdown escapes all tildes ... we don't like that so, we take out all the escape characters
    const withoutEscapedTildes = convertedMd.replaceAll('\\~', '~');

    // Split the content with the split rules provided in `split`
    const splits = splitWt(withoutEscapedTildes, split);
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

async function readAndSplitDocx (split: SplitInfo, fileRelativePath: string): Promise<DocSplit | null> {
    let html: string;
    try {
        // Use mammoth to convert the docx to html
        const fullFilePath = vscode.Uri.joinPath(extension.rootPath, fileRelativePath);
        const result = await mammoth.convertToHtml({
            path: fullFilePath.fsPath
        }, {
            ignoreEmptyParagraphs: false,
            includeDefaultStyleMap: true,
            styleMap: [
                'u => u'
            ]
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

async function readAndSplitOdt (split: SplitInfo, fileRelativePath: string): Promise<DocSplit | null> {
    let html: string;
    try {
        const fullFilePath = vscode.Uri.joinPath(extension.rootPath, fileRelativePath);
        const odtArr = await vscode.workspace.fs.readFile(fullFilePath);
        const odtBuf = Buffer.from(odtArr);
        const result: Buffer = await libreofficeConvert.convertAsync(odtBuf, "html", "");
        html = result.toString();
    }
    catch (e) {
        vscode.window.showErrorMessage(`Error ocurred when parsing html from source odt '${fileRelativePath}': ${e}`);
        throw e;
    }
    return doHtmlSplits(split, html);
}

function getSplitInfo (doc: DocInfo): SplitInfo {
    let fragmentSplitRegex: RegExp | undefined = undefined;
    if (doc.shouldSplitFragments) {
        let fragmentSplitStr = doc.fragmentSplitRegex;
        // fragmentSplitStr = '(^|\n)' + fragmentSplitStr;
        if (!fragmentSplitStr.endsWith("\n")) fragmentSplitStr = fragmentSplitStr + '\n';
        try {
            fragmentSplitRegex = new RegExp(fragmentSplitStr, 'g');
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error creating regex from provided fragment split string '${fragmentSplitStr}': ${e}`);
            throw e;
        }
    }

    let snipSplitRegex: RegExp | undefined = undefined;
    if (doc.shouldSplitSnips) {
        let snipSplitStr = doc.outerSplitRegex;
        // snipSplitStr = '(^|\n)' + snipSplitStr;
        if (!snipSplitStr.endsWith("\n")) snipSplitStr = snipSplitStr + '\n';
        try {
            snipSplitRegex = new RegExp(snipSplitStr, 'g');
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error creating regex from provided snip split string '${snipSplitStr}': ${e}`);
            throw e;
        }
    }

    return {
        useNonGenericFragmentNames: doc.useNonGenericFragmentNames,
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
    title: string | null,
    content: string,
    config: { [index: string]: ConfigFileInfo },
    ordering: number,
): Promise<string> {
    // Create the fragment file
    const fragmentFileName = getUsableFileName('fragment', true);
    const fragmentUri = vscode.Uri.joinPath(containerUri, fragmentFileName);
    await vscode.workspace.fs.writeFile(fragmentUri, Buff.from(content, 'utf-8'));

    // Add the record for this fragment to the config map
    config[fragmentFileName] = {
        title: title && title.length !== 0 ? title : `Imported Fragment (${ordering})`,
        ordering: ordering
    };

    return fragmentFileName;
}

async function writeChapter (docSplits: DocSplit, chapterInfo: ChapterInfo) {

    if (docSplits.type === 'multi') {
        // If there are multiple splits, then call write snip to write the new snips into the chapter

        // First create snip info
        for (let index = 0; index < docSplits.data.length; index++) {
            const { title: chapterName, data } = docSplits.data[index];
            const currentChapter: ChapterInfo = {
                type: 'chapter',
                outputChapterName: chapterName && chapterName.length !== 0
                    ? chapterName
                    : `${chapterInfo.outputChapterName} ${index}`
            };

            const currentChapterFragments: DocSplit = {
                type: 'single',
                data: data,
            };
            await writeChapter(currentChapterFragments, currentChapter);

        }
        return;
    }

    const outlineView: OutlineView = extension.ExtensionGlobals.outlineView;
    const chapterUri: vscode.Uri | null = await outlineView.newChapter(undefined, {
        preventRefresh: false, 
        defaultName: chapterInfo.outputChapterName,
        skipFragment: true
    });
    if (!chapterUri) return;

    const dotConfig: { [index: string]: ConfigFileInfo } = {};

    if (docSplits.type === 'none') {
        // Create the single snip and store their config data inside of the dotConfig created above
        await createFragmentFromSource(chapterUri, null, docSplits.data, dotConfig, 0);
    }
    else if (docSplits.type === 'single') {
        // Create all snips and store their config data inside of the dotConfig created above
        let ordering = 0;
        await Promise.all(docSplits.data.map(split => {
            const { title, data: content } = split;
            const promise = createFragmentFromSource(chapterUri, title, content, dotConfig, ordering);
            ordering++;
            return promise;
        }));
    }

    // Write the .config file to the location of the chapter folder
    const dotConfigJSON = JSON.stringify(dotConfig);
    const dotConfigUri = vscode.Uri.joinPath(chapterUri, `.config`);
    await vscode.workspace.fs.writeFile(dotConfigUri, Buff.from(dotConfigJSON, 'utf-8'));
}

async function writeSnip (docSplits: DocSplit, snipInfo: SnipInfo, droppedSource: DroppedSourceInfo | null) {
    const outlineView: OutlineView = extension.ExtensionGlobals.outlineView;
    
    // Get the parent node where the new snip(s) should be inserted
    let parentNode: OutlineNode | undefined;
    const output = snipInfo.output;

    if (droppedSource) {
        parentNode = droppedSource.node;
    }
    else if (output.dest === 'snip') {
        const snipUri = vscode.Uri.joinPath(extension.rootPath, output.outputSnipPath);
        const snipNode: OutlineNode | null = await outlineView.getTreeElementByUri(snipUri);
        if (!snipNode) return;
        // dest = 'snip' -> inserted snips are work snips
        parentNode = snipNode;
    }
    else if (output.dest === 'chapter') {
        // dest = 'chapter' -> inserted snips are inserted into the specified chapter
        // Find the chapter by its uri and use that as the parent node
        const chapterUri = vscode.Uri.joinPath(extension.rootPath, output.outputChapter);
        const chapterNode: OutlineNode | null = await outlineView.getTreeElementByUri(chapterUri);
        if (!chapterNode) return;
        parentNode = chapterNode;
    }

    // Make a date string for the new snip aggregate
    const dateStr = getSnipDateString();

    // If this is a multi split, then we want to store all splits in a newly created snip container in the `parentNode` calculated above
    if (docSplits.type === 'multi') {
    
        // Create the new snip
        const importedSnipSnipUri = await outlineView.newSnip(parentNode, {
            defaultName: `${snipInfo.outputSnipName} ${dateStr}`,
            preventRefresh: true,
            skipFragment: true,
        });
        if (importedSnipSnipUri !== null) {
            // Get the snip from the outline tree and assign it as the destination for imports
            const snipNodeNode = await outlineView.getTreeElementByUri(importedSnipSnipUri);
            if (snipNodeNode) {
                parentNode = snipNodeNode;
            }
        }
    }

    // There's some kind of race condition somewhere, don't really care enough to find it.  This fixes it.  :)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Uploads fragments in a content array into specified path
    const fragmentUpload = async (splits: NamedSingleSplit[], snipUri: vscode.Uri) => {
        const dotConfig: { [index: string]: ConfigFileInfo } = {};

        let ordering = 0;
        await Promise.all(splits.map(split => {
            const { title, data: content } = split;
            const promise = createFragmentFromSource(snipUri, title, content, dotConfig, ordering);
            ordering++;
            return promise;
        }));

        // Write the .config file to the location of the snip folder
        const dotConfigJSON = JSON.stringify(dotConfig);
        const dotConfigUri = vscode.Uri.joinPath(snipUri, `.config`);
        await vscode.workspace.fs.writeFile(dotConfigUri, Buff.from(dotConfigJSON, 'utf-8'));
    };
    
    if (docSplits.type === 'multi') {
        // Create multiple snips, and load fragment data inside of each
        for (let snipOrdering = 0; snipOrdering < docSplits.data.length; snipOrdering++) {
            const { title: snipTitle, data: fragmentContent } = docSplits.data[snipOrdering];

            // Create current snip
            const snipName = snipTitle && snipTitle.length !== 0 ? snipTitle : `${snipInfo.outputSnipName} (${snipOrdering})`;
            const snipUri: vscode.Uri | null = await outlineView.newSnip(parentNode, {
                preventRefresh: true, 
                defaultName: snipName,
                skipFragment: true
            });
            if (!snipUri) return;
            
            // Upload this snip's fragments
            await fragmentUpload(fragmentContent, snipUri);
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

        let contents: NamedSingleSplit[];
        if (docSplits.type === 'none') {
            // If there are no splits, put the single content item in an array
            contents = [ {
                title: null,
                data: docSplits.data
            } ];
        }
        else {
            // Otherwise, use the data array from single split
            contents = docSplits.data;
        }

        await fragmentUpload(contents, snipUri);
    }
}




function postProcessSplits (splits: DocSplit): DocSplit {
    function postProcessFragment (content: string): string {
        const replacedString = Object.entries(commonReplacements).reduce((acc, [ from, to ]) => {
            return acc.replaceAll(from , to);
        }, content);
    
        return replacedString.replaceAll(/\n +\n/g, '\n\n');
    }

    if (splits.type === 'multi' && splits.data.length === 1 && splits.data[0].title === null) {
        splits = {
            type: "single",
            data: splits.data[0].data
        }
    }

    if (splits.type === 'multi') {
        splits.data.forEach(data => data.data.forEach(data => postProcessFragment(data.data)));
    }
    else if (splits.type === 'single') {
        splits.data.forEach(data => postProcessFragment(data.data));
    }
    else {
        splits.data = postProcessFragment(splits.data);
    }

    return splits;
}


async function createDocumentSplits (
    doc: DocInfo, 
    fileRelativePath: string, 
    workSnipAdditionalPath: string
): Promise<[ DocSplit, WriteInfo ] | null> {
    if (doc.skip) {
        vscode.window.showWarningMessage(`Skipping '${fileRelativePath}' . . . `);
        return null;
    }

    // Get the information needed for splitting this document
    const splitInfo = getSplitInfo(doc);

    // Find the splitting (and reading) function
    let splitFunc: (split: SplitInfo, fileRelativePath: string) => Promise<DocSplit | null>;
    switch (doc.ext) {
        case 'wt': splitFunc = readAndSplitWt; break;
        case 'txt': splitFunc = readAndSplitTxt; break;
        case 'docx': splitFunc = readAndSplitDocx; break;
        case 'html': splitFunc = readAndSplitHtml; break;
        case 'odt': splitFunc = readAndSplitOdt; break;
        case 'md': splitFunc = readAndSplitMd; break;
    }
    // Read and split the document
    const docSplit = await splitFunc(splitInfo, fileRelativePath);
    if (!docSplit) return null;

    const splits: DocSplit = postProcessSplits(docSplit);

    // Create a write info struct for this write
    const writeInfo: WriteInfo = getWriteInfo(doc);
    if (writeInfo.type === 'snip' && writeInfo.output.dest === 'snip') {
        writeInfo.output.outputSnipPath += workSnipAdditionalPath;
    }

    return [ splits, writeInfo ]
}


export async function handleImport (docInfo: ImportDocumentInfo, droppedSource: DroppedSourceInfo | null) {
    
    const docNames = Object.getOwnPropertyNames(docInfo);
    const docLastModified: { 
        name: string,
        lastModified: number 
    }[] = [];

    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: ""
    }, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {

        progress.report({ message: "Preparing import" });
        
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
    
        // If the count of docs to import into work snips is greater than 1 then make a new container
        //      where all the work snips items for this import will be inserted
        let workSnipsParentFileName = '';
        const workSnipsCount = Object.entries(docInfo).filter(([_, info]) => info.outputType === 'snip' && !info.outputIntoChapter && !info.outputIntoDroppedSource).length;
        if (docNames.length > 1 && workSnipsCount > 1) {
            progress.report({ message: "Creating containers" });
            
            // If there is more than one work snip account to import, then make a parent container to insert all work snips into
            const outlineView: OutlineView = extension.ExtensionGlobals.outlineView;
            const workSnipsContainer = (outlineView.rootNodes[0].data as RootNode).snips;
            const snipUri = await outlineView.newSnip(workSnipsContainer, {
                defaultName: `Imported ${getSnipDateString()}`,
                preventRefresh: true,
                skipFragment: true,
            });
            await outlineView.refresh(true, []);
            if (snipUri) {
                const snipNode: OutlineNode | null = await outlineView.getTreeElementByUri(snipUri);
                if (snipNode) {
                    workSnipsParentFileName = snipNode.data.ids.fileName;
                }
            }
        }

        const report = getSectionedProgressReporter(docNames, progress);
    
        // Process imports for each imported file
        for (let index = 0; index < docNames.length; index++) {
            const docRelativePath = docNames[index];
            const doc = docInfo[docRelativePath];
            report(`Processing '${docRelativePath}' [${index + 1} of ${docNames.length}]`);
            try {
                let workSnipAdditionalPath = '';
                if (doc.outputType === 'snip' && !doc.outputIntoChapter) {
                    workSnipAdditionalPath += workSnipsParentFileName;
                }

                const splitResult = await createDocumentSplits(doc, docRelativePath, workSnipAdditionalPath);
                if (splitResult === null) return;
                
                const [ docSplits, writeInfo ] = splitResult;

                // Finally, write the document to the file system
                // Call the chapter/snip specific write function
                if (writeInfo.type === 'chapter') {
                    await writeChapter(docSplits, writeInfo);
                }
                else if (writeInfo.type === 'snip') {
                    await writeSnip(docSplits, writeInfo, doc.outputIntoDroppedSource ? droppedSource : null);
                }
            }
            catch (e) {
                vscode.window.showErrorMessage(`Error occurred when importing '${docRelativePath}': ${e}`);
            }
        }
    
        // Do the expensive full refresh
        vscode.commands.executeCommand('wt.outline.refresh');
    });
}


export async function handlePreview (docName: string, singleDoc: DocInfo, droppedSource: DroppedSourceInfo | null): Promise<Li | null> {
    return vscode.window.withProgress<Li | null>({
        location: vscode.ProgressLocation.Notification,
        title: ""
    }, async (progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<Li | null> => {

        progress.report({ message: "Preparing import" });
    
        const workSnipsParentName =  `Imported ${getSnipDateString()}`;
        const workSnipAdditionalPathName = getUsableFileName('snip');
    
        let splits: DocSplit;
        let writeInfo: WriteInfo;

        // Process imports for each imported file
        const doc = singleDoc;
        progress.report({ message: `Processing '${docName}'` });
        try {
            let workSnipAdditionalPath = '';
            if (doc.outputType === 'snip' && !doc.outputIntoChapter) {
                workSnipAdditionalPath += workSnipAdditionalPathName;
            }
            const docSplits = await createDocumentSplits(doc, docName, workSnipAdditionalPath);
            if (docSplits === null) return null;

            splits = docSplits[0];
            writeInfo = docSplits[1];
        }
        catch (e) {
            vscode.window.showErrorMessage(`Error occurred when importing '${docName}': ${e}`);
            return null;
        }


        const liFragment = (title: string, text: string): Li => ({
            name: `(fragment) ${title}`,
            children: [{
                name: text,
                children: []
            }]
        });

        const docSplits = splits;
        if (writeInfo.type === 'chapter') {
            const chapterInfo = writeInfo;


            const transcribeChapter = (singleOrNoneSplit: NoSplit | SingleSplit): Li[] => {
                if (singleOrNoneSplit.type === 'none') {
                    return [ liFragment(`Imported Fragment`, singleOrNoneSplit.data) ];
                }
                else if (singleOrNoneSplit.type === 'single') {
                    // Create all snips and store their config data inside of the dotConfig created above
                    return singleOrNoneSplit.data.map((split, index) => {
                        const { title, data: content } = split;
                        return liFragment(title || `Imported Fragment (${index+1})`, content);
                    });
                }
                else throw 'Unreachable';
            };

            let chapters: Li[];
            if (docSplits.type === 'multi') {
                chapters = docSplits.data.map(({ title: chapterName, data }, index) => {
                    const chapterNameFinal = chapterName && chapterName.length !== 0
                        ? chapterName
                        : `${chapterInfo.outputChapterName} ${index}`;

                    const chapterContent = transcribeChapter({
                        type: 'single',
                        data: data,
                    });

                    return {
                        name: `(chapter) ${chapterNameFinal}`,
                        children: chapterContent
                    };
                });
            }
            else {
                const chapterNumber = ((extension.ExtensionGlobals.outlineView.rootNodes[0].data as RootNode).chapters.data as ContainerNode).contents.length;
                const chapterName = `(chapter) New Chapter (${chapterNumber})`;
                chapters = [{
                    name: chapterName,
                    children: transcribeChapter(docSplits)
                }]
            }

            return __<Li>({ 
                name: `${extension.ExtensionGlobals.workspace.config.title}/Chapters`,
                children: chapters
            });
        }
        else {
            const snipInfo = writeInfo;
            const outlineView: OutlineView = extension.ExtensionGlobals.outlineView;

            // Get the parent node where the new snip(s) should be inserted
            let parentNodeDisplayName: string = `${extension.ExtensionGlobals.workspace.config.title}/Work Snips/Imported Snips`;
            const output = snipInfo.output;
            if (singleDoc.outputIntoDroppedSource && droppedSource) {
                parentNodeDisplayName = droppedSource.namePath;
            }
            else if (output.dest === 'snip') {
                if (output.outputSnipPath.endsWith(workSnipAdditionalPathName)) {
                    const snipUri = vscode.Uri.joinPath(extension.rootPath, output.outputSnipPath.replace(`/${workSnipAdditionalPathName}`, ''));
                    const snipNode: OutlineNode = await outlineView.getTreeElementByUri(snipUri) || outlineView.rootNodes[0];
                    parentNodeDisplayName = await getNodeNamePath(snipNode) + '/' + workSnipsParentName;
                }
                else {
                    const snipUri = vscode.Uri.joinPath(extension.rootPath, output.outputSnipPath);
                    const parent: OutlineNode = await outlineView.getTreeElementByUri(snipUri) || outlineView.rootNodes[0];
                    parentNodeDisplayName = await getNodeNamePath(parent);
                }
            }
            else if (output.dest === 'chapter') {
                // dest = 'chapter' -> inserted snips are inserted into the specified chapter
                // Find the chapter by its uri and use that as the parent node
                const chapterUri = vscode.Uri.joinPath(extension.rootPath, output.outputChapter);
                let parent: OutlineNode = await outlineView.getTreeElementByUri(chapterUri) || outlineView.rootNodes[0];
                if (parent.data.ids.type === 'chapter') {
                    const chapter = parent.data as ChapterNode
                    parent = chapter.snips;
                }
                parentNodeDisplayName = await getNodeNamePath(parent);
            }

            // Make a date string for the new snip aggregate
            const dateStr = getSnipDateString();

            // If this is a multi split, then we want to store all splits in a newly created snip container in the `parentNode` calculated above
            if (docSplits.type === 'multi') {
                parentNodeDisplayName += `/${snipInfo.outputSnipName} ${dateStr}`;
            }

            // Uploads fragments in a content array into specified path
            const fragmentUpload = (splits: NamedSingleSplit[]): Li[] => {
                return splits.map((split, ordering) => {
                    const { title, data: content } = split;
                    return liFragment(title && title.length !== 0 ? title : `Imported Fragment (${ordering})`, content);
                });
            };
            
            
            let snips: Li[];

            if (docSplits.type === 'multi') {
                // Create multiple snips, and load fragment data inside of each
                snips = docSplits.data.map(({ title: snipTitle, data: fragmentContent }, snipOrdering) => {
                    const snipName = snipTitle && snipTitle.length !== 0 ? snipTitle : `${snipInfo.outputSnipName} (${snipOrdering})`;
                    return {
                        name: `(snip) ${snipName}`,
                        children: fragmentUpload(fragmentContent)
                    }
                });
            }
            else {
                let contents: NamedSingleSplit[];
                if (docSplits.type === 'none') {
                    // If there are no splits, put the single content item in an array
                    contents = [ {
                        title: null,
                        data: docSplits.data
                    } ];
                }
                else {
                    // Otherwise, use the data array from single split
                    contents = docSplits.data;
                }
                snips = [ {
                    name: `(snip) ${snipInfo.outputSnipName}`,
                    children: fragmentUpload(contents)
                } ]
            }

            return __<Li>({
                name: parentNodeDisplayName,
                children: snips,
            })
        }
    });
}