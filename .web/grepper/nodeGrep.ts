import { isSubdirectory } from '../help';
import { Extension } from './../../extension'
import * as vscode from 'vscode';
import { buildMarkdownIgnoringRegex } from './common';


export async function nodeGrep (
    document: vscode.TextDocument,
    searchBarValue: string, 
    useRegex: boolean, 
    useCaseInsensitive: boolean, 
    useWholeWord: boolean,
    useNodeDescriptions: boolean,
    useIgnoreStyleCharacters: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null>;


export async function nodeGrep (
    document: vscode.TextDocument,
    inlineSearchRegex: RegExp,
    cancellationToken: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null>;

export async function nodeGrep (
    document: vscode.TextDocument,
    searchBarValueOrInlineSearchRegex: string | RegExp, 
    useRegexOrCancelationToken: boolean | vscode.CancellationToken, 
    useCaseInsensitive?: boolean, 
    useWholeWord?: boolean,
    useNodeDescriptions?: boolean,
    useIgnoreStyleCharacters?: boolean,
    cancellationToken?: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null> {
    let inlineSearchRegex: RegExp;
    
    if (typeof searchBarValueOrInlineSearchRegex === 'string') {
        const captureGroupId = 'searchResult';
        
        let flags = 'g';
        if (useCaseInsensitive) {
            flags += 'i';
        }

        const searchBarValue = searchBarValueOrInlineSearchRegex;
        const useRegex = useRegexOrCancelationToken as boolean;
        useCaseInsensitive = useCaseInsensitive!;
        useWholeWord = useWholeWord!;
        cancellationToken = cancellationToken!;
        
        // inline search regex is a secondary regex which makes use of NodeJS's regex capture groups
        //      to do additional searches inside of CONTENTS_OF_LINE for the actual matched text
        let inlineSource = searchBarValue;
        if (!useRegex) {
            inlineSource = buildMarkdownIgnoringRegex(inlineSource);
        }

        inlineSearchRegex = new RegExp(`(?<${captureGroupId}>${inlineSource})`, flags);
        if (useWholeWord) {
            inlineSearchRegex = new RegExp(`${Extension.wordSeparator}(?<${captureGroupId}>${inlineSource})${Extension.wordSeparator}`, flags);
        }
    }
    else {
        inlineSearchRegex = searchBarValueOrInlineSearchRegex as RegExp;
        cancellationToken = useRegexOrCancelationToken as vscode.CancellationToken;
    }

    const captureGroupId = 'searchResult';
    const output: [ vscode.Location, string ][] = [];

    const lines = document.getText().split('\n');
    for (let line = 0; line < lines.length; line++) {
        const lineContents = lines[line];

        let lineMatch: RegExpExecArray | null;

        // Since there can be multiple matched values for the search regex inside of CONTENTS_OF_LINE
        //      we need to continually apply the inlineSearchRegex to CONTENTS_OF_LINE until all matches 
        //      run out
        while ((lineMatch = inlineSearchRegex.exec(lineContents)) !== null) {
            let characterStart = lineMatch.index;

            // Using the captureGroupId we baked into the inlineSearchRegex, we can isolate just the current 
            //      matched text from the whole line
            const actualMatchedText = lineMatch.groups?.[captureGroupId] || lineMatch[lineMatch.length - 1];

            // In lined search results are also off-by-one
            if (inlineSearchRegex) {
                characterStart += lineMatch[0].indexOf(actualMatchedText);
            }

            // Index of the ending character of the vscode Location is derived by getting the starting character of the 
            //      of the grep result + the length of the searchedText
            const characterEnd = characterStart + actualMatchedText.length;

            // Create positions and ranges for the Location
            const startPosition = new vscode.Position(line, characterStart);
            const endPosition = new vscode.Position(line, characterEnd);
            const foundRange = new vscode.Selection(startPosition, endPosition);
    
            // As long as the Uri belongs to this vscode workspace then yield this location
            const uri = document.uri;
            if (
                (
                    uri.fsPath.toLocaleLowerCase().endsWith('.wt') 
                    || uri.fsPath.toLocaleLowerCase().endsWith('.wtnote') 
                    || uri.fsPath.toLocaleLowerCase().endsWith('.md') 
                    || uri.fsPath.toLocaleLowerCase().endsWith('.config')
                )
                && 
                (
                    isSubdirectory(Extension.workspace.chaptersFolder, uri)
                    || isSubdirectory(Extension.workspace.workSnipsFolder, uri)
                    || isSubdirectory(Extension.workspace.notebookFolder, uri)
                    || isSubdirectory(Extension.workspace.scratchPadFolder, uri)
                )
            ) {
                // Finally, finally, finally yield the result
                output.push([ new vscode.Location(uri, foundRange), actualMatchedText ]);
                if (output.length > 100000) {
                    return output;
                } 
            }
        }
    }
    return output;
}

async function getDataDirectoryPaths(): Promise<vscode.Uri[]> {
    const found: vscode.Uri[] = [];
    async function walkDirectory(directory: vscode.Uri) {
        
        const files = await vscode.workspace.fs.readDirectory(directory);
        for (const [name, type] of files) {
            const filePath = vscode.Uri.joinPath(directory, name);

            if (type === vscode.FileType.Directory) {
                // Recursively walk subdirectories
                await walkDirectory(filePath);
            } 
            else if (type === vscode.FileType.File && (
                name.toLocaleLowerCase().endsWith('.wt') || name.toLocaleLowerCase().endsWith('.wtnote')  || name.toLocaleLowerCase().endsWith('.md') || name.toLocaleLowerCase() === '.config')
            ) {
                found.push(filePath);
            }
        }
    }

    await walkDirectory(vscode.Uri.joinPath(Extension.rootPath, 'data'));
    return found;
}

export async function nodeGrepExtensionDirectory (
    searchBarValue: string, 
    useRegex: boolean, 
    useCaseInsensitive: boolean, 
    useWholeWord: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null>  {

    const captureGroupId = 'searchResult';

    let flags = 'g';
    if (useCaseInsensitive) {
        flags += 'i';
    }

    // inline search regex is a secondary regex which makes use of NodeJS's regex capture groups
    //      to do additional searches inside of CONTENTS_OF_LINE for the actual matched text
    let inlineSource = searchBarValue;
    if (!useRegex) {
        inlineSource = inlineSource.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    let inlineSearchRegex: RegExp = new RegExp(`(?<${captureGroupId}>${inlineSource})`, flags);
    if (useWholeWord) {
        inlineSearchRegex = new RegExp(`${Extension.wordSeparator}(?<${captureGroupId}>${inlineSource})${Extension.wordSeparator}`, flags);
    }

    const output: [ vscode.Location, string ][] = [];
    try {
        const applicableUris = await getDataDirectoryPaths();

        const documentPromises: Thenable<vscode.TextDocument>[] = applicableUris
            .map(uri => vscode.workspace.openTextDocument(uri));

        const documents: vscode.TextDocument[] = [];

        const totalCount = documentPromises.length;
        let completedFilesCount = 0;
        while (completedFilesCount < totalCount) {
            const [ openedDoc, index ] = await Promise.any<[vscode.TextDocument, number]>(documentPromises
                .map((p, i) => p.then(v => [v, i] as [vscode.TextDocument, number]))
            );

            const grepResults = await nodeGrep(openedDoc, inlineSearchRegex, cancellationToken);
            grepResults && output.push(...grepResults);
            
            completedFilesCount++;
            documentPromises.splice(index, 1);
            documents.push(openedDoc);
        }
        return output;
    }
    catch (err: any) {
        console.log(err);
        Extension.searchBarView.setSearchBarError(searchBarValue, `${err}`);
        return [];
    }

}