/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ConfigFileInfo, getLatestOrdering, readDotConfig } from '../../help';
import { TreeNode } from './outlineTreeProvider';
import { ChapterNode, ContainerNode, FragmentData, NodeTypes, ResourceType, RootNode, SnipNode } from './fsNodes';
import * as extension from '../../extension';


export type InitializeNode<T extends TreeNode> = (data: NodeTypes<T>) => T;

export function initializeOutline<T extends TreeNode>(init: InitializeNode<T>): T {

    const dataFolderPath = `${extension.rootPath}/data`;
    const chaptersFolderPath = `${dataFolderPath}/chapters`;
    const snipsFolderPath = `${dataFolderPath}/snips`;

    let chapterEntries, snipEntries;
    try {
        const dfEntries = fs.readdirSync(dataFolderPath);
        let chaptersFound = false;
        let snipsFound = false;
        dfEntries.find((entry: string) => {
            if (entry === 'chapters') { chaptersFound = true; }
            if (entry === 'snips') { snipsFound = true; }
        });
        if (!chaptersFound) {
            vscode.window.showErrorMessage(`Error initializing workspace from file system: '/data/chapters' wasn't found.  Please do not mess with the file system of an IWE environment.`);
            throw new Error(`Error initializing workspace from file system: '/data/chapters' wasn't found.  Please do not mess with the file system of an IWE environment.`);
        }
        if (!snipsFound) {
            vscode.window.showErrorMessage(`Error initializing workspace from file system: '/data/snips' wasn't found.  Please do not mess with the file system of an IWE environment.`);
            throw new Error(`Error initializing workspace from file system: '/data/snips' wasn't found.  Please do not mess with the file system of an IWE environment.`);
        }

        chapterEntries = fs.readdirSync(chaptersFolderPath, { withFileTypes: true });
        snipEntries = fs.readdirSync(snipsFolderPath, { withFileTypes: true });
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

    const chapters = chapterEntries.filter((entry: { isDirectory: () => any; }) => entry.isDirectory());
    const snips = snipEntries.filter((entry: { isDirectory: () => any; }) => entry.isDirectory());
    
    const dotConfigChaptersPath = `${chaptersFolderPath}/.config`;
    const dotConfigChapters = readDotConfig(dotConfigChaptersPath);
    if (!dotConfigChapters) throw new Error('Error loading chapter config');

    const chapterContainerId = uuidv4();

    // Parse all chapters
    const chapterNodes = chapters.map((chapter: { name: string; }) => init(initializeChapter({
        dotConfig: dotConfigChapters,
        relativePath: `data/chapters`, 
        fileName: chapter.name, 
        rootInternalId: chapterContainerId,
        init
    })));

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

    const dotConfigSnipsPath = `${snipsFolderPath}/.config`;
    const dotConfigSnips = readDotConfig(dotConfigSnipsPath);
    if (!dotConfigSnips) throw new Error('Error loading snips config');

    const snipsContainerId = uuidv4();

    // Parse all work snips
    const snipNodes = snips.map((snip: { name: string; }) => init(initializeSnip({
        dotConfig: dotConfigSnips,
        relativePath: `data/snips`, 
        fileName: snip.name, 
        parentTypeId: 'root', 
        parentId: snipsContainerId,
        init
    })));

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

function initializeChapter <T extends TreeNode> ({
    dotConfig,
    relativePath,
    fileName,
    rootInternalId,
    init,
}: ChapterParams<T>): ChapterNode<T> {
    
    const chapterFolderAbsPath = `${extension.rootPath}/${relativePath}/${fileName}`;

    const displayName = dotConfig[fileName] === undefined ? fileName : dotConfig[fileName].title;
    const ordering = dotConfig[fileName] === undefined ? 10000 : dotConfig[fileName].ordering;

    let chapterFolderEntries;
    try {
        chapterFolderEntries = fs.readdirSync(chapterFolderAbsPath, { withFileTypes: true });
    }
    catch (e) {
        vscode.commands.executeCommand('setContext', 'wt.valid', false);
        // When we fail to read the chapter folder, fail out
        vscode.window.showErrorMessage(`Error: could not read chapter folder at path '${chapterFolderAbsPath}': ${e}`);
        throw e;
    }

    // Keep the files that end with .wt
    // These are the text fragments for the chapter
    const wtEntries = chapterFolderEntries.filter(entry => {
        return entry.isFile() && entry.name.endsWith('.wt');
    });

    // Find the folder that stores all the snips for this chapter
    const snipsFolder = chapterFolderEntries.find(entry => {
        return entry.isDirectory() && entry.name === 'snips';
    });

    const chapterFragmentsDotConfigPath = `${chapterFolderAbsPath}/.config`;
    const chapterFragmentsDotConfig = readDotConfig(chapterFragmentsDotConfigPath);
    if (!chapterFragmentsDotConfig) throw new Error('Error loading chapter fragments config');

    const chapterInternalId = uuidv4();
    
    // Create all the text fragments
    const fragments: FragmentData[] = [];
    for (const entry of wtEntries) {
        const fragmentName = entry.name;
        const fragment = initializeFragment({
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
        const snipsAbsPath = `${chapterFolderAbsPath}/snips`;
        const snipEntries = fs.readdirSync(snipsAbsPath, { withFileTypes: true });


        const chapterSnipsDotConfigPath = `${chapterFolderAbsPath}/snips/.config`;
        const chapterSnipsDotConfig = readDotConfig(chapterSnipsDotConfigPath);
        if (!chapterSnipsDotConfig) throw new Error('Error loading snips config');

        // Iterate over every directory in the snips folder
        for (const entry of snipEntries) {
            if (!entry.isDirectory()) { continue; }
            const snipName = entry.name;
            const snip = initializeSnip({
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

function initializeSnip<T extends TreeNode> ({
    dotConfig,
    relativePath,
    fileName,
    parentTypeId,
    parentId,
    init,
}: SnipParams<T>): SnipNode<T> {

    const snipFolderAbsPath = `${extension.rootPath}/${relativePath}/${fileName}`;

    const displayName = dotConfig[fileName] === undefined ? fileName : dotConfig[fileName].title;
    const ordering = dotConfig[fileName] === undefined ? 10000 : dotConfig[fileName].ordering;

    let snipFolderEntries;
    try {
        snipFolderEntries = fs.readdirSync(snipFolderAbsPath, { withFileTypes: true });
    }
    catch (e) {
        vscode.commands.executeCommand('setContext', 'wt.valid', false);
        // When we fail to read the snip folder, fail out
        vscode.window.showErrorMessage(`Error: could not read sni[] folder at path '${snipFolderAbsPath}': ${e}`);
        throw e;
    }

    // Keep the files that end with .wt
    // These are the text fragments for the snip
    const wtEntries = snipFolderEntries.filter(entry => {
        return entry.isFile() && entry.name.endsWith('.wt');
    });

    const snipFragmentsDotConfigPath = `${snipFolderAbsPath}/.config`;
    const snipFragmentsDotConfig = readDotConfig(snipFragmentsDotConfigPath);
    if (!snipFragmentsDotConfig) throw new Error('Error loading chapter fragments config');

    const snipInternalId = uuidv4();
    
    // Create all the text fragments
    const fragments: FragmentData[] = [];
    for (const entry of wtEntries) {
        const fragmentName = entry.name;
        const fragment = initializeFragment({
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
    let filePreview = '';
    try {
        const fd = fs.openSync(completePath, 'r');
        const buf = Buffer.alloc(200);
        const bytesRead = fs.readSync(fd, buf, 0, 200, 0);
        filePreview = buf.filter(x => x !== 0).toString().replace('\\u0000', '');
        if (bytesRead === 200) {
            // If the number of bytes read is exactly 200, we'll assume that there is more
            //      than that in the file and add some elipses
            filePreview += '...';
        }
        else if (bytesRead === 0) {
            filePreview = '';
        }
        fs.close(fd);
    }
    catch (e) {
        vscode.commands.executeCommand('setContext', 'wt.valid', false);
        filePreview = `Error reading file '${relativePath}'`;
    }
    return filePreview;
}

type FragmentParams = {
    dotConfig: { [index: string]: ConfigFileInfo },
    relativePath: string,
    fileName: string,
    parentTypeId: ResourceType,
    parentInternalId: string,
    watch?: (uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }) => vscode.Disposable
};

function initializeFragment ({
    dotConfig, 
    relativePath,
    fileName,
    parentTypeId,
    parentInternalId,
    watch,
}: FragmentParams): FragmentData {

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
    const completePath = `${extension.rootPath}/${fragmentRelativePath}`;


    // Read the first 200 characters of the markdown string
    const md = readFilePreview(completePath, fragmentRelativePath);
    
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