/* eslint-disable curly */
import * as vscode from 'vscode';
import * as extension from '../extension';
import { ExportForm } from './exportFormView';
import { Buff } from '../Buffer/bufferSource';

// Converts html to docx
// eslint-disable-next-line @typescript-eslint/naming-convention
const HTMLToDOCX = require('html-to-docx');

// Converts html to pdf
import { Workspace } from '../workspace/workspaceClass';
import { OutlineView } from '../outline/outlineView';
import { wtToHtml } from './wtToHtml';
import { ChapterNode, ContainerNode, OutlineNode, RootNode } from '../outline/nodes_impl/outlineNode';

// Data provided by the export form webview
export type ExportDocumentInfo = {
    fileName: string,
    ext: 'md' | 'txt' | 'docx' | 'html',
    separateChapters: boolean,
    combineFragmentsOn: string | null,
    titleChapters: boolean,
    skipChapterTitleFirst: boolean,
    skipChapterTitleLast: boolean,
};

type ChapterInfo = {
    title: string,
    markdown: string
};

// TOTEST: initially when I tested exports, I simply tested whether the exporting worked
// TOTEST: but I never tested how the exporting worked with stylizing of the text
// TOTEST: essentially, just make sure that italics, bolds, and headings get successfully converted
// TOTEST:      during the export process

// Stitches the markdown data of all .wt fragments in chapter into a single markdown string
async function stitchFragments (node: ChapterNode, combineString: string | null): Promise<ChapterInfo | null> {

    const fragmentsData: string[] = [];

    // Read all fragment markdown strings and insert them into the fragmentsData array
    const fragments = node.textData;
    // Sort the fragments first
    fragments.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);
    for (const fragment of fragments) {
        const fragmentUri = fragment.getUri();
        try {
            // Read the fragment markdown string
            const fragmentBuffer = await vscode.workspace.fs.readFile(fragmentUri);
            fragmentsData.push(extension.decoder.decode(fragmentBuffer));
        }
        catch (e) {
            vscode.window.showErrorMessage(`ERROR: an error occurred while reading the contents of fragment '${fragment.data.ids.display}' with path '${fragmentUri}': ${e}`);
            return null;
        }
    }

    // If there is a combine string, surround it in double newlines
    // Otherwise, just use a double newline
    const finalCombineString = combineString === null ? '\n\n' : `\n\n${combineString}\n\n`;

    // Combine all fragments

    // Pop the first fragment from the beginning of the fragments array
    const firstFragment = fragmentsData.shift();
    if (!firstFragment) return {
        title: node.ids.display,
        markdown: ''
    };

    // Fold all fragments into a single string, using the combine string as the glue between the two
    //      of them
    const markdownString = fragmentsData.reduce((acc, fragmentString) => {
        return `${acc}${finalCombineString}${fragmentString}`;
    }, firstFragment);

    return {
        title: node.ids.display,
        markdown: markdownString
    };
}

type SingleFile = {
    type: 'single',
    exportUri: vscode.Uri,
    fileName: string,
    fullData: string | Buffer
};

type CleanedChapterInfo = {
    cleanedTitle: string,
    data: string | Buffer
};

type MultipleFiles = {
    type: 'multiple',
    exportUri: vscode.Uri,
    cleanedChapterInfo: CleanedChapterInfo[]
};

type Processed = SingleFile | MultipleFiles | null;
type ProcessedMd = SingleFile | MultipleFiles;
type ProcessedHtml = SingleFile | MultipleFiles;
type ProcessedPdf = SingleFile | MultipleFiles;
type ProcessedDocx = SingleFile | MultipleFiles;



async function doProcessMd (
    workspace: Workspace,
    ex: ExportDocumentInfo, 
    exportUri: vscode.Uri,
    outline: OutlineView
): Promise<Processed> {
    // Since the export md is also used for exporting txt, the actual ext type of the output file is 
    //      should just be .ext of the parameter export info
    const exportFileType: string = ex.ext;

    // Read all fragments from all chapters
    const root: RootNode = outline.rootNodes[0].data as RootNode;
    const chaptersContainer: ContainerNode = root.chapters.data as ContainerNode;
    const chaptersNodes: OutlineNode[] = chaptersContainer.contents;

    // Sort the chapters
    chaptersNodes.sort((a, b) => a.data.ids.ordering - b.data.ids.ordering);

    // Stitch all chapter fragments together
    const chaptersData: (ChapterInfo | null)[] = await Promise.all(chaptersNodes.map(node => {
        const chapter = node.data as ChapterNode;
        return stitchFragments(chapter, ex.combineFragmentsOn);
    }));

    // Make sure that there are no failures in reading any of the fragments
    if (chaptersData.find(x => x === null)) {
        return null;
    }
    const finalData = chaptersData as ChapterInfo[];

    const off = ex.skipChapterTitleFirst ? 0 : 1;
    if (ex.separateChapters) {
        // CASE: exports the markdown chapters into separate files
        // Use the specified file name from the export form to create a folder that will contain all exported chapters
        const exportContainerUri = vscode.Uri.joinPath(exportUri, ex.fileName);
        try {
            await vscode.workspace.fs.createDirectory(exportContainerUri);
        }
        catch (e) {
            vscode.window.showErrorMessage(`ERROR: an error ocurred when creating a container for exported chapters: ${e}`);
            return null;
        }

        // Then, clean all the chapter names so that they can be used as file names
        const cleanedChapters: CleanedChapterInfo[] = finalData.map((chapterInfo, index) => {
            const title = chapterInfo.title;
            const markdown = chapterInfo.markdown;

            // Determine the chapter prefix based in the values of `titleChapters`, `skipChapterTitleFirst`, and `skipChapterTitleLast`
            let chapterPrefix = '';
            let documentChapterPrefix = '';
            if (ex.titleChapters) {
                documentChapterPrefix = `chapter_${index+off}_`;
                chapterPrefix = `Chapter ${index+off}: `;
                if (index === 0 && ex.skipChapterTitleFirst) {
                    chapterPrefix = '';
                    documentChapterPrefix = ``;
                }
                if (index === finalData.length - 1 && ex.skipChapterTitleLast) {
                    chapterPrefix = '';
                    documentChapterPrefix = ``;
                }
            }

            const markdownWithChapterHeader = `#${chapterPrefix}${chapterInfo.title}\n\n${markdown}`;

            // Replace all illegal characters in the chapter title with the very legal character '-'
            const cleanedTitle = title.replaceAll(workspace.illegalCharacters.join(''), '-');
            if (cleanedTitle !== title) {
                vscode.window.showWarningMessage(`Chapter titled '${title}' contained illegal characters for file name, using file name '${cleanedTitle}' instead.`);
            }

            // Include index of the chapter in the final file name
            //      This is so that the user cannot lose track of the original ordering of output files
            // Also include chapter title prefix from above
            const finalFileName = `${index}__${documentChapterPrefix}${cleanedTitle}`;

            // Return the cleaned title, and markdown
            return {
                cleanedTitle: finalFileName,
                data: markdownWithChapterHeader
            };
        });

        // Return the multiple files
        return <MultipleFiles>{
            type: 'multiple',
            exportUri: exportContainerUri,
            cleanedChapterInfo: cleanedChapters,
        };
    }
    else {
        // CASE: exports everything into a single file
        // Combine all the chapters, using chapter names as glue
        const fullFileMarkdown = finalData.reduce((acc, chapterInfo, index) => {

            // Determine the chapter prefix based in the values of `titleChapters`, `skipChapterTitleFirst`, and `skipChapterTitleLast`
            let chapterPrefix = '';
            if (ex.titleChapters) {
                chapterPrefix = `Chapter ${index+off}: `;
                if (index === 0 && ex.skipChapterTitleFirst) {
                    chapterPrefix = '';
                }
                if (index === finalData.length - 1 && ex.skipChapterTitleLast) {
                    chapterPrefix = '';
                }
            }

            // Chapter title (as heading), double newline, chapter contents, double newline
            // Give enough space between chapter titles and content, as well as enough space between
            //      different chapters themselves
            return `${acc}#${chapterPrefix}${chapterInfo.title}\n\n${chapterInfo.markdown}\n`;
        }, '');

        return <SingleFile>{
            type: 'single',
            exportUri: exportUri,
            fileName: ex.fileName,
            fullData: fullFileMarkdown,
        } as SingleFile;
    }
}

async function doProcessHtml (processedMd: ProcessedMd): Promise<ProcessedHtml> {
    if (processedMd.type === 'single') {
        // Process the single markdown file into an html string
        const singleMd = processedMd as SingleFile;
        // Convert the single md string to a single html string and return the new SingleFile struct
        const convertedHtml = wtToHtml(singleMd.fullData.toString(), true);
        return <SingleFile>{
            type: 'single',
            fileName: singleMd.fileName,
            fullData: convertedHtml,
            exportUri: singleMd.exportUri
        } as SingleFile;
    }
    else {
        // Process all html files into separate html strings
        const multipleMd = processedMd as MultipleFiles;

        // Convert all md chapters to html chapters
        const convertedChapters = multipleMd.cleanedChapterInfo.map(cleaned => {
            const convertedHtml = wtToHtml(cleaned.data.toString(), false);
            return {
                cleanedTitle: cleaned.cleanedTitle,
                data: convertedHtml
            } as CleanedChapterInfo;
        });

        // Return new MultipleFiles with the converted html
        return <MultipleFiles>{
            type: "multiple",
            cleanedChapterInfo: convertedChapters,
            exportUri: multipleMd.exportUri
        } as MultipleFiles;
    }
}

async function doProcessDocx (processedHtml: ProcessedHtml): Promise<ProcessedDocx> {
    if (processedHtml.type === 'single') {
        const singleHtml = processedHtml.fullData;
        const docx: Buffer = await HTMLToDOCX(singleHtml, '<p></p>', {
            margins: {
                top: 1080,
                bottom: 1080,
                left: 1080,
                right: 1080,
                header: 0,
                footer: 0,
                gutter: 0
            },
            footer: true,
            pageNumber: true,
            title: processedHtml.fileName,
            fontSize: 22,
            orientation: 'portrait'
        });
        return <SingleFile>{
            type: 'single',
            exportUri: processedHtml.exportUri,
            fileName: processedHtml.fileName,
            fullData: docx
        };
    }
    else {
        const multipleHtml = processedHtml.cleanedChapterInfo;

        const convertedDocx: CleanedChapterInfo[] = [];

        // Convert all md chapters to html chapters
        for (const cleaned of multipleHtml) {
            // Convert the html to docx
            const docx: Buffer = await HTMLToDOCX(cleaned.data, '<p></p>', {
                margins: {
                    top: 1080,
                    bottom: 1080,
                    left: 1080,
                    right: 1080,
                    header: 0,
                    footer: 0,
                    gutter: 0
                },
                footer: true,
                pageNumber: true,
                title: cleaned.cleanedTitle,
                fontSize: 22,
                orientation: 'portrait'
            });

            // Push the converted docx and its title to
            convertedDocx.push({
                cleanedTitle: cleaned.cleanedTitle,
                data: docx
            });
        }

        return <MultipleFiles>{
            type: 'multiple',
            exportUri: processedHtml.exportUri,
            cleanedChapterInfo: convertedDocx
        };
    }
}


async function exportGeneric (fullyProcessed: ProcessedMd | ProcessedHtml | ProcessedDocx | ProcessedPdf, ext: string) {

    const exportData = async (data: string | Buffer, destination: vscode.Uri) => {
        if (typeof data === 'string') {
            const result = extension.encoder.encode(data.toString());
            return vscode.workspace.fs.writeFile(destination, result);
        }
        else {
            const result = data;
            return vscode.workspace.fs.writeFile(destination, result);
        }
    };

    if (fullyProcessed.type === 'single') {
        // Write the single file to the export folder
        const destinationFolderUri = fullyProcessed.exportUri;
        const destinationUri = vscode.Uri.joinPath(destinationFolderUri, `${fullyProcessed.fileName}.${ext}`);
        const tmp2 = fullyProcessed.fullData;
        //@ts-ignore
        await exportData(tmp2, destinationUri)
    }
    else {
        const destinationFolderUri = fullyProcessed.exportUri;
        await Promise.all(fullyProcessed.cleanedChapterInfo.map(chapter => {
            // Write the chapter to the disk
            const chapterFileName = chapter.cleanedTitle;
            const chapterData = chapter.data;
            const fullChapterUri = vscode.Uri.joinPath(destinationFolderUri, `${chapterFileName}.${ext}`);
            return exportData(chapterData, fullChapterUri);
        }));
    }
}

// Exporting a txt file is simply treated the same as exporting an md file, which is the same as a generic export
const exportMd = async (fullyProcessed: ProcessedMd) => {
    await exportGeneric(fullyProcessed, 'md');
};
const exportTxt = async (fullyProcessed: ProcessedMd) => {
    await exportGeneric(fullyProcessed, 'txt');
};

// Export html converts the markdown strings into html strings, then generically export it
async function exportHtml (processed: ProcessedMd) {
    const convertedHtml = await doProcessHtml(processed);
    await exportGeneric(convertedHtml, 'html');
}

// Export html converts the markdown to html, then html to docx, then generically exports it
async function exportDocx (processed: ProcessedMd) {
    const convertedHtml = await doProcessHtml(processed);
    const convertedDocx = await doProcessDocx(convertedHtml);
    await exportGeneric(convertedDocx, 'docx');
}

export async function handleDocumentExport (
    this: ExportForm, 
    workspace: Workspace, 
    exportInfo: ExportDocumentInfo,
    outline: OutlineView
) {
    // First, create the output folder for this particular output

    // Not sure if there is a better way of formatting dates in JS: 
    // All the docs I found were pretty cringe, so I'm doing it myself
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth();
    const year = now.getFullYear();

    // Formate the date in as a string with a format that the fs will allow
    const dateString = `${month}_${day}_${year}`;

    // Create the export folder
    const dirname = `export (${dateString})`;
    const dirUri = vscode.Uri.joinPath(workspace.exportFolder, dirname);

    let dirExists = true;
    try { await vscode.workspace.fs.stat(dirUri) }
    catch (err: any) {
        dirExists = false;
    }

    try {
        await vscode.workspace.fs.createDirectory(dirUri);
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR an error occurred while creating the export directory: ${e}`);
        return;
    }

    // Process all the markdown in this work
    const processed: Processed = await doProcessMd(workspace, exportInfo, dirUri, outline);
    if (!processed) {
        return;
    }
    const success: ProcessedMd = processed as ProcessedMd;

    // Get the correct export function and perform the export
    let exportFunction: (processed: ProcessedMd) => Promise<void>;
    switch (exportInfo.ext) {
        case 'md': exportFunction = exportMd; break;
        case 'txt': exportFunction = exportTxt; break;
        case 'docx': exportFunction = exportDocx; break;
        case 'html': exportFunction = exportHtml; break;
    }
    await exportFunction(success);
    vscode.window.showInformationMessage(`Successfully exported files into '${dirUri.fsPath}'`);
}
