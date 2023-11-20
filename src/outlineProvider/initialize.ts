/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { ConfigFileInfo, getLatestOrdering, readDotConfig } from '../help';
import { TreeNode } from './outlineTreeProvider';
import { ChapterNode, ContainerNode, FragmentNode, NodeTypes, ResourceType, RootNode, SnipNode } from './fsNodes';
import * as extension from '../extension';


export type InitializeNode<T extends TreeNode> = (data: NodeTypes<T>) => T;

export async function initializeOutline<T extends TreeNode>(init: InitializeNode<T>): Promise<T> {

    const dataFolderUri = vscode.Uri.joinPath(extension.rootPath, `data`);
    const chaptersContainerUri = vscode.Uri.joinPath(dataFolderUri, `chapters`);
    const workSnipsContainerUri = vscode.Uri.joinPath(dataFolderUri, `snips`);

    let chapterEntries: [ string, vscode.FileType ][];
    let snipEntries: [ string, vscode.FileType ][];
    try {
        const dfEntries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(dataFolderUri);
        let chaptersFound = false;
        let snipsFound = false;
        dfEntries.find(([ name, _ ]) => {
            if (name === 'chapters') { chaptersFound = true; }
            if (name === 'snips') { snipsFound = true; }
        });
        if (!chaptersFound) {
            vscode.window.showErrorMessage(`Error initializing workspace from file system: '/data/chapters' wasn't found.  Please do not mess with the file system of an IWE environment.`);
            throw new Error(`Error initializing workspace from file system: '/data/chapters' wasn't found.  Please do not mess with the file system of an IWE environment.`);
        }
        if (!snipsFound) {
            vscode.window.showErrorMessage(`Error initializing workspace from file system: '/data/snips' wasn't found.  Please do not mess with the file system of an IWE environment.`);
            throw new Error(`Error initializing workspace from file system: '/data/snips' wasn't found.  Please do not mess with the file system of an IWE environment.`);
        }

        chapterEntries = await vscode.workspace.fs.readDirectory(chaptersContainerUri);
        snipEntries = await vscode.workspace.fs.readDirectory(workSnipsContainerUri);
    }
    catch (e) {
        vscode.commands.executeCommand('setContext', 'wt.valid', false);
        let message: string | undefined = undefined;
        if (typeof e === 'string') {
            message = e;
        }
        else if (e instanceof Error) {
            message = e.message;
        }
        if (message) {
            vscode.window.showErrorMessage(message);
        }
        throw e;
    }

    const chapters = chapterEntries.filter(([ _, fileType ]) => fileType === vscode.FileType.Directory);
    const snips = snipEntries.filter(([ _, fileType ]) => fileType === vscode.FileType.Directory);
    
    const dotConfigChaptersUri = vscode.Uri.joinPath(chaptersContainerUri, `.config`);
    const dotConfigChapters = await readDotConfig(dotConfigChaptersUri);
    if (!dotConfigChapters) throw new Error('Error loading chapter config');

    // Parse all chapters

    const chapterNodes: T[] = []
    for (const [ name, _ ] of chapters) {
        chapterNodes.push(init(await initializeChapter({
            parentDotConfig: dotConfigChapters,
            relativePath: `data/chapters`, 
            fileName: name, 
            chaptersContainerUri: chaptersContainerUri,
            init
        })));
    }

    // Insert chapters into a container
    const chapterContainerNode: ContainerNode<T> = {
        ids: {
            type: 'container',
            display: 'Chapters',
            fileName: 'chapters',
            uri: chaptersContainerUri,
            ordering: 0,
            parentUri: dataFolderUri,
            parentTypeId: 'root',
            relativePath: 'data'
        },
        contents: chapterNodes
    };
    const chapterContainer = init(chapterContainerNode);

    const dotConfigSnipsUri = vscode.Uri.joinPath(workSnipsContainerUri, '.config');
    const dotConfigSnips = await readDotConfig(dotConfigSnipsUri);
    if (!dotConfigSnips) throw new Error('Error loading snips config');

    // Parse all work snips
    const snipNodes: T[] = [];
    for (const [ name,  _ ] of snips) {
        snipNodes.push(
            init(await initializeSnip({
                parentDotConfig: dotConfigSnips,
                relativePath: `data/snips`, 
                fileName: name, 
                parentTypeId: 'root', 
                parentUri: workSnipsContainerUri,
                init
            }))
        );
    }

    // Insert work snips into a container
    const snipsContainerNode: ContainerNode<T> = {
        ids: {
            type: 'container',
            display: 'Work Snips',
            fileName: 'snips',
            uri: workSnipsContainerUri,
            ordering: 1,
            parentUri: dataFolderUri,
            parentTypeId: 'root',
            relativePath: 'data'
        },
        contents: snipNodes
    };
    const snipContainer = init(snipsContainerNode);

    const outlineNode: RootNode<T> = {
        ids: {
            type: 'root',
            display: 'root',
            uri: dataFolderUri,
            relativePath: 'data',
            fileName: '',
            parentTypeId: 'root',
            parentUri: vscodeUris.Utils.joinPath(extension.rootPath, 'data'),
            ordering: 0,
        },
        chapters: chapterContainer as T,
        snips: snipContainer as T
    };
    return init(outlineNode);
}

type ChapterParams<T extends TreeNode> = {
    parentDotConfig: { [index: string]: ConfigFileInfo },
    relativePath: string,
    fileName: string,
    chaptersContainerUri: vscode.Uri,
    init: InitializeNode<T>,
};

export async function initializeChapter <T extends TreeNode> ({
    parentDotConfig,
    relativePath,
    fileName,
    chaptersContainerUri,
    init,
}: ChapterParams<T>): Promise<ChapterNode<T>> {
    
    const chapterFolderUri = vscodeUris.Utils.joinPath(chaptersContainerUri, fileName);

    const displayName = parentDotConfig[fileName] === undefined ? fileName : parentDotConfig[fileName].title;
    const ordering = parentDotConfig[fileName] === undefined ? 10000 : parentDotConfig[fileName].ordering;

    let chapterFolderEntries: [ string, vscode.FileType ][];
    try {
        chapterFolderEntries = await vscode.workspace.fs.readDirectory(chapterFolderUri);
    }
    catch (e) {
        vscode.commands.executeCommand('setContext', 'wt.valid', false);
        // When we fail to read the chapter folder, fail out
        vscode.window.showErrorMessage(`Error: could not read chapter folder at path '${chapterFolderUri.fsPath}': ${e}`);
        throw e;
    }

    // Keep the files that end with .wt
    // These are the text fragments for the chapter
    const wtEntries = chapterFolderEntries.filter(([ name, fileType ]) => {
        return fileType === vscode.FileType.File && name.endsWith('.wt');
    });

    // Find the folder that stores all the snips for this chapter
    const snipsFolder = chapterFolderEntries.find(([ name, fileType ]) => {
        return fileType === vscode.FileType.Directory && name === 'snips';
    });

    const chapterFragmentsDotConfigUri = vscodeUris.Utils.joinPath(chapterFolderUri, `.config`);
    const chapterFragmentsDotConfig = await readDotConfig(chapterFragmentsDotConfigUri);
    if (!chapterFragmentsDotConfig) throw new Error('Error loading chapter fragments config');

    // Create all the text fragments
    const fragments: FragmentNode[] = [];
    for (const [ name, _ ] of wtEntries) {
        const fragmentName = name;
        const fragment = await initializeFragment({
            relativePath: `${relativePath}/${fileName}`, 
            fileName: fragmentName, 
            parentDotConfig: chapterFragmentsDotConfig,
            parentTypeId: 'chapter',
            parentUri: chapterFolderUri,
        });
        fragments.push(fragment);
    }

    // Create snips
    
    const snips: SnipNode<T>[] = [];
    // Read the entries in the snips folder
    const snipsContainerUri = vscode.Uri.joinPath(chapterFolderUri, `snips`);
    if (snipsFolder) {
        const snipEntries: [ string, vscode.FileType ][] = await vscode.workspace.fs.readDirectory(snipsContainerUri);

        const chapterSnipsDotConfigUri = vscode.Uri.joinPath(chapterFolderUri, `snips/.config`);
        const chapterSnipsDotConfig = await readDotConfig(chapterSnipsDotConfigUri);
        if (!chapterSnipsDotConfig) throw new Error('Error loading snips config');

        // Iterate over every directory in the snips folder
        for (const [ name, fileType ] of snipEntries) {
            if (fileType !== vscode.FileType.Directory) { continue; }
            const snipName = name;
            const snip = await initializeSnip({
                parentDotConfig: chapterSnipsDotConfig,
                relativePath: `${relativePath}/${fileName}/snips`, 
                fileName: snipName,
                parentTypeId: 'chapter',
                parentUri: snipsContainerUri,
                init
            });
            snips.push(snip);
        }
    }

    const fragmentNodes = fragments.map(frag => init(frag));
    const snipNodes = snips.map(snip => init(snip));

    const snipContainerNode: ContainerNode<T> = {
        ids: {
            type: 'container',
            display: "Snips",
            fileName: 'snips',
            uri: snipsContainerUri,
            ordering: 1000000,
            parentUri: chapterFolderUri,
            parentTypeId: 'chapter',
            relativePath: `${relativePath}/${fileName}`,
        },
        contents: snipNodes as T[],
    };
    const snipContainer = init(snipContainerNode);

    return {
        ids: {
            type: 'chapter',
            display: displayName,
            ordering: ordering,
            uri: chapterFolderUri,
            relativePath: relativePath,
            fileName: fileName,
            parentTypeId: 'root',
            parentUri: chaptersContainerUri,
        },
        snips: snipContainer as T,
        textData: fragmentNodes as T[]
    };
}

type SnipParams<T extends TreeNode> = {
    parentDotConfig: { [index: string]: ConfigFileInfo },
    relativePath: string,
    fileName: string,
    parentTypeId: ResourceType,
    parentUri: vscode.Uri,
    init: InitializeNode<T>,
};

export async function initializeSnip<T extends TreeNode> ({
    parentDotConfig,
    relativePath,
    fileName,
    parentTypeId,
    parentUri,
    init,
}: SnipParams<T>): Promise<SnipNode<T>> {

    const snipFolderUri = vscodeUris.Utils.joinPath(parentUri, fileName);

    const displayName = parentDotConfig[fileName] === undefined ? fileName : parentDotConfig[fileName].title;
    const ordering = parentDotConfig[fileName] === undefined ? 10000 : parentDotConfig[fileName].ordering;

    let snipFolderEntries: [ string, vscode.FileType ][];
    try {
        snipFolderEntries = await vscode.workspace.fs.readDirectory(snipFolderUri);
    }
    catch (e) {
        vscode.commands.executeCommand('setContext', 'wt.valid', false);
        // When we fail to read the snip folder, fail out
        vscode.window.showErrorMessage(`Error: could not read sni[] folder at path '${snipFolderUri.fsPath}': ${e}`);
        throw e;
    }

    // Keep the files that end with .wt
    // These are the text fragments for the snip
    const wtEntries = snipFolderEntries.filter(([ name, fileType ]) => {
        return fileType === vscode.FileType.File && name.endsWith('.wt');
    });

    const snipFragmentsDotConfigUri = vscodeUris.Utils.joinPath(snipFolderUri, `.config`);
    const snipFragmentsDotConfig = await readDotConfig(snipFragmentsDotConfigUri);
    if (!snipFragmentsDotConfig) throw new Error('Error loading chapter fragments config');

    // Create all the text fragments
    const fragments: FragmentNode[] = [];
    for (const [ name, _ ] of wtEntries) {
        const fragmentName = name;
        const fragment = await initializeFragment({
            relativePath: `${relativePath}/${fileName}`, 
            fileName: fragmentName, 
            parentDotConfig: snipFragmentsDotConfig,
            parentTypeId: 'snip',
            parentUri: snipFolderUri,
        });
        fragments.push(fragment);
    }

    const fragmentNodes = fragments.map(frag => init(frag));

    return {
        ids: {
            type: 'snip',
            display: displayName,
            ordering: ordering,
            uri: snipFolderUri,
            relativePath: relativePath,
            fileName: fileName,
            parentTypeId: parentTypeId,
            parentUri: parentUri
        },
        textData: fragmentNodes as T[]
    };
}

function readFilePreview (completePath: string, relativePath: string): string {
    // TODO: figure out if it's possible to get file preview with vscode api
    return relativePath;
}

type FragmentParams = {
    parentDotConfig: { [index: string]: ConfigFileInfo },
    relativePath: string,
    fileName: string,
    parentTypeId: ResourceType,
    parentUri: vscode.Uri,
    watch?: (uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }) => vscode.Disposable
};

export async function initializeFragment ({
    parentDotConfig, 
    relativePath,
    fileName,
    parentTypeId,
    parentUri,
    watch,
}: FragmentParams): Promise<FragmentNode> {

    // Get the display name for the fragment
    // If there is no specified display name in the .chapter file,
    //      then use the name of the file
    const fragmentName = fileName;
    let info = parentDotConfig[fragmentName];
    if (!info) {
        // Store the displayName that we're using for future use
        const maxOrdering = getLatestOrdering(parentDotConfig);
        info = {
            title: fileName,
            ordering: maxOrdering + 1
        };
        parentDotConfig[fragmentName] = info;
    }
    const displayName = info.title;
    const ordering = info.ordering === undefined ? 10000 : info.ordering;


    // Create full and relative paths for this fragment
    const fragmentFullPath = vscodeUris.Utils.joinPath(parentUri, fragmentName);


    // Read the first 200 characters of the markdown string
    const md = readFilePreview(fragmentFullPath.fsPath, fragmentName);
    
    return {
        ids: {
            type: 'fragment',
            display: displayName,
            ordering: ordering,
            uri: fragmentFullPath,
            relativePath: relativePath,
            fileName: fragmentName,
            parentTypeId: parentTypeId,
            parentUri: parentUri
        },
        md: md
    };
}