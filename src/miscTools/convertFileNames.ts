import * as vscode from 'vscode';
import { OutlineView } from '../outline/outlineView';
import { ChapterNode, ContainerNode, OutlineNode, RootNode, SnipNode } from '../outline/nodes_impl/outlineNode';
import { getUsableFileName } from '../outline/impl/createNodes';
import * as extension from '../extension';
import { Workspace } from '../workspace/workspaceClass';




type FileInfo = {
    title: string,
    ordering: number
};

class ConfigFile {
    static renames: [ vscode.Uri, vscode.Uri ][] = [];
    private parent: vscode.Uri;
    private cfgPath: vscode.Uri;
    private fileInfo: { [index: string]: FileInfo };
    constructor (parent: vscode.Uri) {
        this.parent = parent;
        this.cfgPath = vscode.Uri.joinPath(parent, '.config');
        this.fileInfo = {};
    }

    addConfig (fileName: string, title: string, ordering: number) {
        this.fileInfo[fileName] = { title, ordering };
    }

    async performRename () {
        const awaitables: Thenable<any>[] = [];
        const newConfigs: { [index: string]: FileInfo } = {};
        for (const [ fn, cfg ] of Object.entries(this.fileInfo)) {
            const [ ft, ...rdlp ] = fn.split('-');
            const newname = getUsableFileName(ft, fn.endsWith('.wt'));
            const fullOld = vscode.Uri.joinPath(this.parent, fn)
            const fullNew = vscode.Uri.joinPath(this.parent, newname);
            
            console.log(`${fullOld.fsPath} => ${fullNew.fsPath}`);
            awaitables.push(
                vscode.workspace.fs.rename(fullOld, fullNew)
                    .then(() => {}, e => console.error(e))
            );
            ConfigFile.renames.push([ fullOld, fullNew ]);
            
            await new Promise((accept, reject) => setTimeout(accept, 10));
            newConfigs[newname] = cfg;
        }

        this.fileInfo = newConfigs;
        await Promise.all(awaitables);

        return vscode.workspace.fs.writeFile(this.cfgPath, extension.encoder.encode(
            JSON.stringify(this.fileInfo)
        ));
    }

    async childDirs (): Promise<vscode.Uri[]> {
        const children = [];
        const fileNames = [ ...Object.keys(this.fileInfo), 'snips' ];
        for (const fileName of fileNames) {
            const childPath = vscode.Uri.joinPath(this.parent, fileName);
            let stat: vscode.FileStat | undefined;
            try {
                stat = await vscode.workspace.fs.stat(childPath)
            }
            catch (err: any) {}

            if (stat && stat.type === vscode.FileType.Directory) {
                children.push(childPath);
            }
        }
        return children;
    }
    
    static async fromConfig (path: vscode.Uri): Promise<null | ConfigFile> {
        const configPath = vscode.Uri.joinPath(path, '.config');
        let stat: vscode.FileStat | undefined;
        try {
            stat = await vscode.workspace.fs.stat(configPath)
        }
        catch (err: any) {}

        if (!stat || stat.type !== vscode.FileType.File) {
            return null;
        }

        const cfgObject = new ConfigFile(path);
        const cfgJson: { [index: string]: FileInfo } = JSON.parse(extension.decoder.decode(
            await vscode.workspace.fs.readFile(configPath)
        ));

        for (const [ fileName, info ] of Object.entries(cfgJson)) {
            const title = info.title;
            const ordering = info.ordering;
            cfgObject.addConfig(fileName, title, ordering);
        }
        return cfgObject;
    }
}


export async function convertFileNames () {

    const doConvert = await vscode.window.showInformationMessage("Convert File Names", {
        modal: true,
        detail: `
Convert file names in the WTANIWE directory?
Older versions of WTANIWE used much longer file names than the newest versions.   This may cause some problems for some Operating Systems who have limits on file path sizes.  
If you encounter this problem, hit 'Continue' to rename all files in the WTANIWE 'chapters' and 'snips' directories.  

Before executing, make sure all files are saved, and you might want to do a git commit to be safe.

In terms of git, git *should* recognize all file name updates as renames rather than re-writes, so you *should* be able to continue to track
files as you were before the rename.`
    }, 'Continue');

    if (!doConvert || doConvert !== 'Continue') {
        return;
    }

    const chaptersDir = vscode.Uri.joinPath(extension.rootPath, 'data', 'chapters');
    const snipsDir = vscode.Uri.joinPath(extension.rootPath, 'data', 'snips');

    const configs: ConfigFile[] = [];
    const q: vscode.Uri[] = [ chaptersDir, snipsDir ];
    while (q.length !== 0) {
        const cfg = await ConfigFile.fromConfig(q.pop()!);
        if (!cfg) continue;

        await cfg.performRename();

        configs.push(cfg);
        const next = await cfg.childDirs();
        next.forEach(n => q.push(n));
    }

    const contextValuesPath = vscode.Uri.joinPath(extension.rootPath, `data/contextValues.json`);
    let contextValuesStr = extension.decoder.decode(
        await vscode.workspace.fs.readFile(contextValuesPath)
    );

    for (const [ oldUri, newUri ] of ConfigFile.renames) {
        const oldRel = oldUri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
        const newRel = newUri.fsPath.replace(extension.rootPath.fsPath, '').replaceAll("\\", '/');
        contextValuesStr = contextValuesStr.replaceAll(oldRel, newRel);
    }
    await vscode.workspace.fs.writeFile(contextValuesPath, extension.encoder.encode(
        contextValuesStr
    ));

    return vscode.commands.executeCommand('workbench.action.reloadWindow')
}