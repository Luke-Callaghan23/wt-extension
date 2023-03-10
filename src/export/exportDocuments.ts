/* eslint-disable curly */
import * as vscode from 'vscode';
import * as extension from '../extension';
import * as console from '../vsconsole';
import { ExportForm } from './exportFormView';

// Converts md to html
import * as showdown from 'showdown';

// Converts html to docx
// eslint-disable-next-line @typescript-eslint/naming-convention
const HTMLToDOCX = require('html-to-docx');

// Converts html to pdf
import { Workspace } from '../workspace/workspace';
import { OutlineView } from '../outline/outlineView';
import { ChapterNode, ContainerNode, OutlineNode, RootNode } from '../outline/outlineNodes';
import * as pdf from 'html-pdf';

// Data provided by the export form webview
export type ExportDocumentInfo = {
    fileName: string,
    ext: 'pdf' | 'md' | 'txt' | 'docx' | 'html',
    separateChapters: boolean,
    combineFragmentsOn: string | null,
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
            fragmentsData.push(fragmentBuffer.toString());
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
    const root: RootNode = outline.tree.data as RootNode;
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
        const cleanedChapters: CleanedChapterInfo[] = finalData.map(chapterInfo => {
            const title = chapterInfo.title;
            const markdown = chapterInfo.markdown;
            const markdownWithChapterHeader = `#${chapterInfo.title}\n\n~~\n\n${markdown}`;

            // Replace all illegal characters in the chapter title with the very legal character '-'
            const cleanedTitle = title.replaceAll(workspace.illegalCharacters.join(''), '-');
            if (cleanedTitle !== title) {
                vscode.window.showWarningMessage(`Chapter titled '${title}' contained illegal characters for file name, using file name '${cleanedTitle}' instead.`);
            }

            // Return the cleaned title, and markdown
            return {
                cleanedTitle,
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
        const fullFileMarkdown = finalData.reduce((acc, chapterInfo) => {
            // Chapter title (as heading), double newline, chapter contents, double newline
            // Give enough space between chapter titles and content, as well as enough space between
            //      different chapters themselves
            return `${acc}#${chapterInfo.title}\n\n~~\n\n${chapterInfo.markdown}\n\n\n\n\n\n\n\n`;
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

    // Create the showdown converter with options that seem appropriate for formatting
    //      stylized text without (many) extra frills
    const showdownConverter = new showdown.Converter({
        ellipsis: true,
        openLinksInNewWindow: true,
        strikethrough: true,
        underline: true,
        tables: true,
        emoji: true,
        simplifiedAutoLink: true,
        completeHTMLDocument: true,
        tasklists: true,
        simpleLineBreaks: true,
        headerLevelStart: 3,
    });

    if (processedMd.type === 'single') {
        // Process the single markdown file into an html string
        const singleMd = processedMd as SingleFile;
        // Convert the single md string to a single html string and return the new SingleFile struct
        const convertedHtml = showdownConverter.makeHtml(singleMd.fullData as string);

        // Add page break before all of the chapter headers
        const withPageBreaks = convertedHtml.replaceAll('<h3 ', '<div class="page-break" style="page-break-after: always;"></div><h3 ');

        // Except for the first
        const removedFirstPageBreak = withPageBreaks.replace('<div class="page-break" style="page-break-after: always;"></div>', '');

        // Add font size (for potential pdf conversions)
        const withFontSize = removedFirstPageBreak.replace('<html>', `
        <html>
        <style>
        p {
            font-size: 10px;
        }
        h3 {
            font-size: 15px;
        }
        </style>
        `);

        return <SingleFile>{
            type: 'single',
            fileName: singleMd.fileName,
            fullData: withFontSize,
            exportUri: singleMd.exportUri
        } as SingleFile;
    }
    else {

        showdownConverter.setOption('headerLevelStart', 2);

        // Process all html files into separate html strings
        const multipleMd = processedMd as MultipleFiles;

        // Convert all md chapters to html chapters
        const convertedChapters = multipleMd.cleanedChapterInfo.map(cleaned => {
            const convertedHtml = showdownConverter.makeHtml(cleaned.data as string);
            // Add font size (for potential pdf conversions)
            const withFontSize = convertedHtml.replace('<html>', `
            <html>
            <style>
            p {
                font-size: 10px;
            }
            h3 {
                font-size: 15px;
            }
            </style>
            `);
            return {
                cleanedTitle: cleaned.cleanedTitle,
                data: withFontSize
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

async function doProcessPdf (processedHtml: ProcessedHtml): Promise<ProcessedPdf> {
    if (processedHtml.type === 'single') {
        const singleHtml = processedHtml.fullData as string;
        
        // const buffer = 
        const buffer = await new Promise((resolve: (value: Buffer) => void, reject) => {
            pdf.create(singleHtml, { 
                orientation: 'portrait',
                type: 'pdf',
                border: {
                    top: '0.5in',
                    bottom: '0.5in',
                    left: '0.5in',
                    right: '0.5in',
                },
                format: 'A4',
            }).toBuffer((err, buffer) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(buffer);
            });
        });

        // Return the single converted pdf
        return <SingleFile>{
            type: 'single',
            exportUri: processedHtml.exportUri,
            fileName: processedHtml.fileName,
            fullData: buffer
        };
    }
    else {
        const multipleHtml = processedHtml.cleanedChapterInfo;
        const pdfBuffers = await Promise.all(
            // Map the html chapters to an array of promises that return jsPDF instances
            multipleHtml.map(chapterData => {
                const html = chapterData.data as string;
                // Create a promise from the callback-based html conversion function
                return new Promise((resolve: (value: Buffer) => void, reject) => {
                    pdf.create(html, { 
                        orientation: 'portrait',
                        type: 'pdf',
                        border: {
                            top: '0.5in',
                            bottom: '0.5in',
                            left: '0.5in',
                            right: '0.5in',
                        },
                        format: 'A4',
                    }).toBuffer((err, buffer) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(buffer);
                    });
                });
            })
        );

        // Pair all the pdf buffers with their associated metadata
        const convertedChapters = multipleHtml.map((chapterData, index) => {
            const pdf = pdfBuffers[index];
            return {
                cleanedTitle: chapterData.cleanedTitle,
                data: pdf,
            } as CleanedChapterInfo;
        });

        // Return all converted pdfs and the output folder path
        return <MultipleFiles>{
            type: 'multiple',
            cleanedChapterInfo: convertedChapters,
            exportUri: processedHtml.exportUri,
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
    if (fullyProcessed.type === 'single') {
        // Write the single file to the export folder
        const destinationFolderUri = fullyProcessed.exportUri;
        const destinationUri = vscode.Uri.joinPath(destinationFolderUri, `${fullyProcessed.fileName}.${ext}`);
        await vscode.workspace.fs.writeFile(destinationUri, extension.encoder.encode(fullyProcessed.fullData.toString()));
    }
    else {
        const destinationFolderUri = fullyProcessed.exportUri;
        await Promise.all(fullyProcessed.cleanedChapterInfo.map(chapter => {
            // Write the chapter to the disk
            const chapterFileName = chapter.cleanedTitle;
            const chapterData = chapter.data;
            const fullChapterUri = vscode.Uri.joinPath(destinationFolderUri, `${chapterFileName}.${ext}`);
            return vscode.workspace.fs.writeFile(fullChapterUri, extension.encoder.encode(chapterData.toString()));
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

// Export docx converts the markdown to html, then html to docx, then generically exports it
async function exportPdf (processed: ProcessedMd) {
    const convertedHtml = await doProcessHtml(processed);
    const convertedPdf = await doProcessPdf(convertedHtml);
    await exportGeneric(convertedPdf, 'pdf');
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
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();

    // Formate the date in as a string with a format that the fs will allow
    const dateString = `${month}_${day}_${year}-${hour}_${minute}_${second}`;

    // Create the export folder
    const filename = `export (${dateString})`;
    const fileUri = vscode.Uri.joinPath(workspace.exportFolder, filename);
    try {
        await vscode.workspace.fs.createDirectory(fileUri);
    }
    catch (e) {
        vscode.window.showErrorMessage(`ERROR an error occurred while creating the export directory: ${e}`);
        return;
    }

    // Process all the markdown in this work
    const processed: Processed = await doProcessMd(workspace, exportInfo, fileUri, outline);
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
        case 'pdf': exportFunction = exportPdf; break;
    }
    await exportFunction(success);
    vscode.window.showInformationMessage(`Successfully exported files into '${fileUri.fsPath}'`);
}
