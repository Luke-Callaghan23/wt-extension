/* eslint-disable curly */
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ConfigFileInfo, getLatestOrdering, readDotConfig } from '../help';
import { TreeNode } from './outlineTreeProvider';
import { ChapterNode, ContainerNode, FragmentData, NodeTypes, ResourceType, RootNode, SnipNode } from './fsNodes';
import * as extension from '../extension';


export type InitializeNode<T extends TreeNode> = (data: NodeTypes<T>) => T;

export async function initializeOutline<T extends TreeNode>(init: InitializeNode<T>): Promise<T> {

    const dataFolderUri = vscode.Uri.joinPath(extension.rootPath, `data`);
    const chaptersFolderUri = vscode.Uri.joinPath(dataFolderUri, `chapters`);
    const snipsFolderUri = vscode.Uri.joinPath(dataFolderUri, `snips`);

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

        chapterEntries = await vscode.workspace.fs.readDirectory(chaptersFolderUri);
        snipEntries = await vscode.workspace.fs.readDirectory(snipsFolderUri);
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

    const internalId = uuidv4();

    const chapters = chapterEntries.filter(([ _, fileType ]) => fileType === vscode.FileType.Directory);
    const snips = snipEntries.filter(([ _, fileType ]) => fileType === vscode.FileType.Directory);
    
    const dotConfigChaptersUri = vscode.Uri.joinPath(chaptersFolderUri, `.config`);
    const dotConfigChapters = await readDotConfig(dotConfigChaptersUri);
    if (!dotConfigChapters) throw new Error('Error loading chapter config');

    const chapterContainerId = uuidv4();

    // Parse all chapters

    const chapterNodes = []
    for (const [ name, _ ] of chapters) {
        chapterNodes.push(init(await initializeChapter({
            dotConfig: dotConfigChapters,
            relativePath: `data/chapters`, 
            fileName: name, 
            rootInternalId: chapterContainerId,
            init
        })));
    }

    // Insert chapters into a container
    const chapterContainerNode: ContainerNode<T> = {
        ids: {
            type: 'container',
            display: 'Chapters',
            fileName: 'chapters',
            internal: chapterContainerId,
            ordering: 0,
            parentInternalId: internalId,
            parentTypeId: 'root',
            relativePath: 'data'
        },
        contents: chapterNodes
    };
    const chapterContainer = init(chapterContainerNode);

    const dotConfigSnipsUri = vscode.Uri.joinPath(snipsFolderUri, '.config');
    const dotConfigSnips = await readDotConfig(dotConfigSnipsUri);
    if (!dotConfigSnips) throw new Error('Error loading snips config');

    const snipsContainerId = uuidv4();

    // Parse all work snips
    const snipNodes = [];
    for (const [ name,  _ ] of snips) {
        snipNodes.push(
            init(await initializeSnip({
                dotConfig: dotConfigSnips,
                relativePath: `data/snips`, 
                fileName: name, 
                parentTypeId: 'root', 
                parentId: snipsContainerId,
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
            internal: snipsContainerId,
            ordering: 1,
            parentInternalId: internalId,
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
            internal: internalId,
            relativePath: 'data',
            fileName: '',
            parentTypeId: 'root',
            parentInternalId: 'root',
            ordering: 0,
        },
        chapters: chapterContainer as T,
        snips: snipContainer as T
    };
    return init(outlineNode);
}

type ChapterParams<T extends TreeNode> = {
    dotConfig: { [index: string]: ConfigFileInfo },
    relativePath: string,
    fileName: string,
    rootInternalId: string,
    init: InitializeNode<T>,
};

async function initializeChapter <T extends TreeNode> ({
    dotConfig,
    relativePath,
    fileName,
    rootInternalId,
    init,
}: ChapterParams<T>): Promise<ChapterNode<T>> {
    
    const chapterFolderUri = vscode.Uri.joinPath(extension.rootPath, relativePath, fileName);

    const displayName = dotConfig[fileName] === undefined ? fileName : dotConfig[fileName].title;
    const ordering = dotConfig[fileName] === undefined ? 10000 : dotConfig[fileName].ordering;

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

    const chapterFragmentsDotConfigUri = vscode.Uri.joinPath(chapterFolderUri, `.config`);
    const chapterFragmentsDotConfig = await readDotConfig(chapterFragmentsDotConfigUri);
    if (!chapterFragmentsDotConfig) throw new Error('Error loading chapter fragments config');

    const chapterInternalId = uuidv4();
    
    // Create all the text fragments
    const fragments: FragmentData[] = [];
    for (const [ name, _ ] of wtEntries) {
        const fragmentName = name;
        const fragment = await initializeFragment({
            relativePath: `${relativePath}/${fileName}`, 
            fileName: fragmentName, 
            dotConfig: chapterFragmentsDotConfig,
            parentTypeId: 'chapter',
            parentInternalId: chapterInternalId,
        });
        fragments.push(fragment);
    }

    // Create snips
    
    const snipsContainerId = uuidv4();

    const snips: SnipNode<T>[] = [];
    if (snipsFolder) {
        // Read the entries in the snips folder
        const snipsUri = vscode.Uri.joinPath(chapterFolderUri, `snips`);
        const snipEntries: [ string, vscode.FileType ][] = await vscode.workspace.fs.readDirectory(snipsUri);


        const chapterSnipsDotConfigUri = vscode.Uri.joinPath(chapterFolderUri, `snips/.config`);
        const chapterSnipsDotConfig = await readDotConfig(chapterSnipsDotConfigUri);
        if (!chapterSnipsDotConfig) throw new Error('Error loading snips config');

        // Iterate over every directory in the snips folder
        for (const [ name, fileType ] of snipEntries) {
            if (fileType !== vscode.FileType.Directory) { continue; }
            const snipName = name;
            const snip = await initializeSnip({
                dotConfig: chapterSnipsDotConfig,
                relativePath: `${relativePath}/${fileName}/snips`, 
                fileName: snipName,
                parentTypeId: 'chapter',
                parentId: snipsContainerId,
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
            internal: snipsContainerId,
            ordering: 1000000,
            parentInternalId: chapterInternalId,
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
            internal: chapterInternalId,
            relativePath: relativePath,
            fileName: fileName,
            parentTypeId: 'root',
            parentInternalId: rootInternalId,
        },
        snips: snipContainer as T,
        textData: fragmentNodes as T[]
    };
}

type SnipParams<T extends TreeNode> = {
    dotConfig: { [index: string]: ConfigFileInfo },
    relativePath: string,
    fileName: string,
    parentTypeId: ResourceType,
    parentId: string,
    init: InitializeNode<T>,
};

async function initializeSnip<T extends TreeNode> ({
    dotConfig,
    relativePath,
    fileName,
    parentTypeId,
    parentId,
    init,
}: SnipParams<T>): Promise<SnipNode<T>> {

    const snipFolderUri = vscode.Uri.joinPath(extension.rootPath, relativePath, fileName);

    const displayName = dotConfig[fileName] === undefined ? fileName : dotConfig[fileName].title;
    const ordering = dotConfig[fileName] === undefined ? 10000 : dotConfig[fileName].ordering;

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

    const snipFragmentsDotConfigUri = vscode.Uri.joinPath(snipFolderUri, `.config`);
    const snipFragmentsDotConfig = await readDotConfig(snipFragmentsDotConfigUri);
    if (!snipFragmentsDotConfig) throw new Error('Error loading chapter fragments config');

    const snipInternalId = uuidv4();
    
    // Create all the text fragments
    const fragments: FragmentData[] = [];
    for (const [ name, _ ] of wtEntries) {
        const fragmentName = name;
        const fragment = await initializeFragment({
            relativePath: `${relativePath}/${fileName}`, 
            fileName: fragmentName, 
            dotConfig: snipFragmentsDotConfig,
            parentTypeId: 'snip',
            parentInternalId: snipInternalId,
        });
        fragments.push(fragment);
    }

    const fragmentNodes = fragments.map(frag => init(frag));

    return {
        ids: {
            type: 'snip',
            display: displayName,
            ordering: ordering,
            internal: snipInternalId,
            relativePath: relativePath,
            fileName: fileName,
            parentTypeId: parentTypeId,
            parentInternalId: parentId
        },
        textData: fragmentNodes as T[]
    };
}

function readFilePreview (completePath: string, relativePath: string): string {
    // TODO: figure out if it's possible to get file preview with vscode api
    return relativePath;
}

type FragmentParams = {
    dotConfig: { [index: string]: ConfigFileInfo },
    relativePath: string,
    fileName: string,
    parentTypeId: ResourceType,
    parentInternalId: string,
    watch?: (uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }) => vscode.Disposable
};

async function initializeFragment ({
    dotConfig, 
    relativePath,
    fileName,
    parentTypeId,
    parentInternalId,
    watch,
}: FragmentParams): Promise<FragmentData> {

    // Get the display name for the fragment
    // If there is no specified display name in the .chapter file,
    //      then use the name of the file
    const fragmentName = fileName;
    let info = dotConfig[fragmentName];
    if (!info) {
        // Store the displayName that we're using for future use
        const maxOrdering = getLatestOrdering(dotConfig);
        info = {
            title: fileName,
            ordering: maxOrdering + 1
        };
        dotConfig[fragmentName] = info;
    }
    const displayName = info.title;
    const ordering = info.ordering === undefined ? 10000 : info.ordering;


    // Create full and relative paths for this fragment
    const fragmentRelativePath = `${relativePath}/${fragmentName}`;
    const completePath = vscode.Uri.joinPath(extension.rootPath, fragmentRelativePath);


    // Read the first 200 characters of the markdown string
    const md = readFilePreview(completePath.fsPath, fragmentRelativePath);
    
    return {
        ids: {
            type: 'fragment',
            display: displayName,
            ordering: ordering,
            internal: uuidv4(),
            relativePath: relativePath,
            fileName: fragmentName,
            parentTypeId: parentTypeId,
            parentInternalId: parentInternalId
        },
        md: md
    };
}