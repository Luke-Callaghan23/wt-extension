/* eslint-disable curly */
import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { ConfigFileInfo, DotConfig, getLatestOrdering, progressOnViews, readDotConfig } from '../miscTools/help';
import { TreeNode } from './outlineTreeProvider';
import { ChapterNode, ContainerNode, FragmentNode, NodeTypes, ResourceType, RootNode, SnipNode } from './fsNodes';
import { Extension } from   '../extension';


export type InitializeNode<T extends TreeNode> = (data: NodeTypes<T>) => T;

export async function initializeOutline<T extends TreeNode>(viewId: string, init: InitializeNode<T>, dontFail?: boolean): Promise<T> {
    return progressOnViews(viewId, async () => {
        const dataFolderUri = vscode.Uri.joinPath(Extension.rootPath, `data`);
        
        const legacyChaptersContainerUri = Extension.workspace.legacyChaptersFolder;
        const chapterGroupsContainerUri = Extension.workspace.chapterGroupsFolder;

        const workSnipsContainerUri = vscode.Uri.joinPath(dataFolderUri, `snips`);
    
        let legacyChaptersFound = false;
        let chapterGroupsFound = false;
        let snipsFound = false;

        let snipEntries: [ string, vscode.FileType ][];
        try {
            const dfEntries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(dataFolderUri);
            dfEntries.find(([ name, _ ]) => {
                if (name === 'chapters') { legacyChaptersFound = true; }
                if (name === 'chaptergroups') { chapterGroupsFound = true; }
                if (name === 'snips') { snipsFound = true; }
            });

            if (!legacyChaptersFound) {
                if (chapterGroupsFound) {
                    let foundChapterGroupFolder = false;
                    const chapterGroupsEntries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(chapterGroupsContainerUri);
                    for (const [_, ft] of chapterGroupsEntries) {
                        if (ft === vscode.FileType.Directory) {
                            foundChapterGroupFolder = true;
                        }
                    }

                    if (!foundChapterGroupFolder) {
                        vscode.window.showErrorMessage(`Error initializing workspace from file system: Could not find any chapter groups inside of '/data/chaptergroups'.  Please do not mess with the file system of an WTANIWE environment.`);
                        throw new Error(`Error initializing workspace from file system: Could not find any chapter groups inside of '/data/chaptergroups'.  Please do not mess with the file system of an WTANIWE environment.`);
                    }
                }
                else {
                    vscode.window.showErrorMessage(`Error initializing workspace from file system: '/data/chaptergroups' and '/data/chapters/' were both not found.  Please do not mess with the file system of an WTANIWE environment.`);
                    throw new Error(`Error initializing workspace from file system: '/data/chaptergroups' and '/data/chapters/' were both not found.  Please do not mess with the file system of an WTANIWE environment.`);
                }
            }
            if (!snipsFound) {
                vscode.window.showErrorMessage(`Error initializing workspace from file system: '/data/snips' wasn't found.  Please do not mess with the file system of an IWE environment.`);
                throw new Error(`Error initializing workspace from file system: '/data/snips' wasn't found.  Please do not mess with the file system of an IWE environment.`);
            }
    
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
    
        const snips = snipEntries.filter(([ _, fileType ]) => fileType === vscode.FileType.Directory);

        // Need to support both the legacy "data/chapters" folder and the newer "data/chaptergroups" schemas
        // Older versions of WTANIWE could only have one chapter group, and it was always in one place "data/chapters"
        // Whereas newer versions let you add multiple chapter groups and store them all in "data/chaptergroups"
        // Also needs to handle scenarios
        // If there is a mixed version -- i.e. a "data/chapters" folder AND a "data/chaptergroups" folder -- then the 
        //      .config information for BOTH chapter groups live in "data/chaptergroups/.config"
        // The entry for the legacy chapter group will be "../chapters"
        
        type ChapterGroupEntry = {
            fileName: string,
            fileType: vscode.FileType
        };

        let chapterGroupsDotConfig: DotConfig;
        let chapterGroupEntries: ChapterGroupEntry[];
        
        if (legacyChaptersFound) {
            const legacyChaptersEntry: ChapterGroupEntry = {
                fileName: "../chapters",
                fileType: vscode.FileType.Directory
            };


            if (chapterGroupsFound) {
                const chapterGroupsDotConfigUri = vscode.Uri.joinPath(chapterGroupsContainerUri, '.config');
                const chapterGroupsDotConfigTmp = await readDotConfig(chapterGroupsDotConfigUri);
                if (!chapterGroupsDotConfigTmp) throw "Could not find .config file for 'data/chaptergroups'";

                chapterGroupsDotConfig = chapterGroupsDotConfigTmp;
                if (!("../chapters" in chapterGroupsDotConfig)) {
                    // "../chapters" is given an honorary ordering of 0 if there is no entry for it in the 
                    //      chaptergroups .config already
                    chapterGroupsDotConfig["../chapters"] = {
                        ordering: 0,
                        title: "Chapters"
                    };
                }
                
                const chapterGroupFolderEntries = (await vscode.workspace.fs.readDirectory(chapterGroupsContainerUri))
                    .map<ChapterGroupEntry | []>(([ fileName, fileType ]) => {
                        if (fileType !== vscode.FileType.Directory) {
                            return [];
                        }
                        return {
                            fileName: fileName,
                            relativePath: 'data/chaptergroups',
                            fileType: fileType
                        };
                    }).flat();

                chapterGroupEntries = [
                    legacyChaptersEntry,
                    ...chapterGroupFolderEntries,
                ];
            }
            else {
                // If all tbhat exists is the legacy chapters, just add a dummy ../chapters entry in a dummy .config structure
                //      and return just the ../chapters
                chapterGroupsDotConfig = {};
                chapterGroupsDotConfig["../chapters"] = {
                    ordering: 0,
                    title: "Chapters"
                };
                chapterGroupEntries = [ legacyChaptersEntry ];
            }
        }
        else if (chapterGroupsFound) {
            const chapterGroupsFolderDotConfigUri = vscode.Uri.joinPath(chapterGroupsContainerUri, '.config');
            const chapterGroupsFolderDotConfig = await readDotConfig(chapterGroupsFolderDotConfigUri);
            if (!chapterGroupsFolderDotConfig) throw "Could not find .config file for 'data/chaptergroups'";
            
            const chapterGroupFolderEntries = (await vscode.workspace.fs.readDirectory(chapterGroupsContainerUri))
                .map<ChapterGroupEntry>(([ fileName, fileType ]) => {
                    return {
                        fileName: fileName,
                        fileType: fileType
                    };
                });

            chapterGroupsDotConfig = chapterGroupsFolderDotConfig;
            chapterGroupEntries = chapterGroupFolderEntries;
        }
        else {
            // Should be handled above, but just print the error again anyways
            vscode.window.showErrorMessage(`Error initializing workspace from file system: '/data/chaptergroups' and '/data/chapters/' were both not found.  Please do not mess with the file system of an WTANIWE environment.`);
            throw new Error(`Error initializing workspace from file system: '/data/chaptergroups' and '/data/chapters/' were both not found.  Please do not mess with the file system of an WTANIWE environment.`);
        }

        const chapterGroups: ContainerNode<T>[] = [];
        for (const { fileName, fileType } of chapterGroupEntries) {
            if (fileType !== vscode.FileType.Directory) continue;

            const cg = await initalizeChapterGroup({
                fileName: fileName,
                init: init,
                parentDotConfig: chapterGroupsDotConfig,
                parentUri: chapterGroupsContainerUri,
                relativePath: "data/chaptergroups",
                dontFail: dontFail
            });
            chapterGroups.push(cg);
        }

        const chapterGroupsContainerNode: ContainerNode<T> = {
            ids: {
                display: "Chapters",
                fileName: 'chaptergroups',
                ordering: 0,
                type: 'container',
                parentTypeId: 'root',
                relativePath: 'data',
                parentUri: dataFolderUri,
                uri: chapterGroupsContainerUri,
            },
            contents: chapterGroups.map(init),
        };
        const chapterGroupsContainer = init(chapterGroupsContainerNode);

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
                    init,
                    dontFail: dontFail
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
                parentUri: vscodeUris.Utils.joinPath(Extension.rootPath, 'data'),
                ordering: 0,
            },
            chapterGroups: chapterGroupsContainer,
            snips: snipContainer as T
        };
        return init(outlineNode);
    });
}


type ChapterGroupParams<T extends TreeNode> = {
    parentDotConfig: Record<string, ConfigFileInfo>,
    relativePath: string,
    fileName: string,
    parentUri: vscode.Uri,
    init: InitializeNode<T>,
    dontFail?: boolean
};

export async function initalizeChapterGroup <T extends TreeNode> ({
    parentDotConfig,
    relativePath,
    fileName,
    parentUri,
    init,
    dontFail
}: ChapterGroupParams<T>): Promise<ContainerNode<T>> {
    const chapterGroupUri = vscode.Uri.joinPath(parentUri, fileName);

    const chaptersEntries: [ string, vscode.FileType ][] = (await vscode.workspace.fs.readDirectory(chapterGroupUri))
        .filter(([ _, fileType ]) => fileType === vscode.FileType.Directory);

    const dotConfigChaptersUri = vscode.Uri.joinPath(chapterGroupUri, `.config`);
    const dotConfigChapters = await readDotConfig(dotConfigChaptersUri);
    if (!dotConfigChapters) throw new Error('Error loading chapter config');

    const displayName = parentDotConfig[fileName] === undefined ? fileName : parentDotConfig[fileName].title;
    const ordering = parentDotConfig[fileName] === undefined ? 10000 : parentDotConfig[fileName].ordering;
    const description = parentDotConfig[fileName]?.description;
    
    // Parse all chapters
    const chapterNodes: T[] = []
    for (const [ chapterFolderName, _ ] of chaptersEntries) {
        chapterNodes.push(init(await initializeChapter({
            parentDotConfig: dotConfigChapters,
            relativePath: `${relativePath}/${fileName}`,
            fileName: chapterFolderName, 
            chaptersContainerUri: chapterGroupUri,
            init,
            dontFail: dontFail
        })));
    }

    // Insert chapters into a container
    const chapterContainerNode: ContainerNode<T> = {
        ids: {
            type: 'container',
            display: displayName,
            description: description,
            fileName: fileName,
            uri: chapterGroupUri,
            ordering: ordering,
            parentUri: parentUri,
            parentTypeId: 'container',
            relativePath: relativePath
        },
        contents: chapterNodes
    };
    return chapterContainerNode;
}


type ChapterParams<T extends TreeNode> = {
    parentDotConfig: Record<string, ConfigFileInfo>,
    relativePath: string,
    fileName: string,
    chaptersContainerUri: vscode.Uri,
    init: InitializeNode<T>,
    dontFail?: boolean
};

export async function initializeChapter <T extends TreeNode> ({
    parentDotConfig,
    relativePath,
    fileName,
    chaptersContainerUri,
    init,
    dontFail
}: ChapterParams<T>): Promise<ChapterNode<T>> {
    
    const chapterFolderUri = vscodeUris.Utils.joinPath(chaptersContainerUri, fileName);

    const displayName = parentDotConfig[fileName] === undefined ? fileName : parentDotConfig[fileName].title;
    const ordering = parentDotConfig[fileName] === undefined ? 10000 : parentDotConfig[fileName].ordering;
    const description = parentDotConfig[fileName]?.description;

    let chapterFolderEntries: [ string, vscode.FileType ][];
    try {
        chapterFolderEntries = await vscode.workspace.fs.readDirectory(chapterFolderUri);
    }
    catch (e) {
        if (dontFail === undefined || dontFail === false) {
            vscode.commands.executeCommand('setContext', 'wt.valid', false);
            // When we fail to read the chapter folder, fail out
            vscode.window.showErrorMessage(`Error: could not read chapter folder at path '${chapterFolderUri.fsPath}': ${e}`);
        }
        throw e;
    }

    // Keep the files that end with .wt
    // These are the text fragments for the chapter
    const wtEntries = chapterFolderEntries.filter(([ name, fileType ]) => {
        return fileType === vscode.FileType.File && (name.endsWith('.wt') || name.endsWith(".md"));
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
            description: description,
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
    parentDotConfig: Record<string, ConfigFileInfo>,
    relativePath: string,
    fileName: string,
    parentTypeId: ResourceType,
    parentUri: vscode.Uri,
    init: InitializeNode<T>,
    dontFail?: boolean
};

export async function initializeSnip<T extends TreeNode> ({
    parentDotConfig,
    relativePath,
    fileName,
    parentTypeId,
    parentUri,
    init,
    dontFail
}: SnipParams<T>): Promise<SnipNode<T>> {

    const snipFolderUri = vscodeUris.Utils.joinPath(parentUri, fileName);

    const displayName = parentDotConfig[fileName] === undefined ? fileName : parentDotConfig[fileName].title;
    const ordering = parentDotConfig[fileName] === undefined ? 10000 : parentDotConfig[fileName].ordering;
    const description = parentDotConfig[fileName]?.description;

    let snipFolderEntries: [ string, vscode.FileType ][];
    try {
        snipFolderEntries = await vscode.workspace.fs.readDirectory(snipFolderUri);
    }
    catch (e) {
        if (dontFail === undefined || dontFail === false) {
            vscode.commands.executeCommand('setContext', 'wt.valid', false);
            // When we fail to read the snip folder, fail out
            vscode.window.showErrorMessage(`Error: could not read snip folder at path '${snipFolderUri.fsPath}': ${e}`);
        }
        throw e;
    }

    // Keep the files that end with .wt
    // These are the text fragments for the snip
    const innerSnipEntries: [ string, vscode.FileType ][] = [];
    const wtEntries = snipFolderEntries.filter(([ name, fileType ]) => {
        if (fileType === vscode.FileType.Directory) {
            innerSnipEntries.push([ name, fileType ]);
        }
        return fileType === vscode.FileType.File && (name.endsWith('.wt') || name.endsWith('.md'));
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


    // Create all inner snips
    const snips: SnipNode<T>[] = [];
    for (const [ name, ] of innerSnipEntries) {
        const snipName = name;
        // Insert work snips into a container
        const snip = await initializeSnip({
            relativePath: `${relativePath}/${fileName}`,
            fileName: snipName, 
            init: init,
            parentDotConfig: snipFragmentsDotConfig,
            parentTypeId: 'snip',
            parentUri: snipFolderUri,
            dontFail: dontFail
        });
        snips.push(snip);
    }

    const snipNodes = snips.map(snip => init(snip));
    return {
        ids: {
            type: 'snip',
            display: displayName,
            description: description,
            ordering: ordering,
            uri: snipFolderUri,
            relativePath: relativePath,
            fileName: fileName,
            parentTypeId: parentTypeId,
            parentUri: parentUri
        },
        contents: [...fragmentNodes, ...snipNodes] as T[]
    };
}

function readFilePreview (completePath: string, relativePath: string): string {
    // TODO: figure out if it's possible to get file preview with vscode api
    return relativePath;
}

type FragmentParams = {
    parentDotConfig: Record<string, ConfigFileInfo>,
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
            description: info.description,
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