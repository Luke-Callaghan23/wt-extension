import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { prompt } from '../help';
import * as vsconsole from '../vsconsole';
import * as extension from '../extension';
import { gitiniter } from '../gitTransactions';
import { Config } from './workspace';


export class Workspace {
    // Basic configuration information about the workspace
    config: Config = {
        createDate: Date.now(),
        creator: "No one",
        title: "Nothing"
    };

    // Path to the .wtconfig file that supplies the above `Config` information for the workspace
    public dotWtconfigPath: vscode.Uri;

    // Path to all the necessary folders for a workspace to function
    public chaptersFolder: vscode.Uri;
    public workSnipsFolder: vscode.Uri;
    public recyclingBin: vscode.Uri;
    public contextValuesFilePath: vscode.Uri;

    // Returns a list of all 
    getFolders() {
        return [
            this.chaptersFolder, 
            this.workSnipsFolder, 
            this.recyclingBin,
        ];
    }

    // List of allowed import file types
    public importFileTypes: string[] = [
        'pdf',
        'wt',
        'txt',
        'docx',
        'html'
    ];

    // List of allowed export file types
    public exportFileTypes: string[] = [
        'pdf',
        'wt',
        'txt',
        'docx',
        'html'
    ];

    // List of non-allowed characters in exported file names
    public illegalCharacters: string[] = [
        '#',
        '%',
        '&',
        '{',
        '}',
        '\\',
        '<',
        '>',
        '*',
        '?',
        '/',
        ' ',
        '$',
        '!',
        '\'',
        '"',
        ':',
        '@',
        '+',
        '`',
        '|',
        '=',
        '.'
    ];

    // Simply initializes all the paths of necessary 
    constructor() {
        this.dotWtconfigPath = vscode.Uri.joinPath(extension.rootPath, `.wtconfig`);
        this.chaptersFolder = vscode.Uri.joinPath(extension.rootPath, `data/chapters`);
        this.workSnipsFolder = vscode.Uri.joinPath(extension.rootPath, `data/snips`);
        this.recyclingBin = vscode.Uri.joinPath(extension.rootPath, `data/recycling`);
        this.contextValuesFilePath = vscode.Uri.joinPath(extension.rootPath, `data/contextValues.json`);
    }
}