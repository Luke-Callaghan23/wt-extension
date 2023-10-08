import * as vscode from 'vscode';
import { enter } from './enterCodeMode';
import { exit } from './exitCodeMode';
import * as vscodeUri from 'vscode-uri';
import * as console from './../vsconsole';
import { isText } from 'istextorbinary';
// import { fileTypeFromBuffer, fileTypeFromStream } from 'file-type';
import { Buff } from '../Buffer/bufferSource';
export class CoderModer {

    repoLocation: vscode.Uri | undefined;
    repoUris: vscode.Uri[] | undefined;
    openedCodeUris: vscode.Uri[] = [];

    enter = enter;
    exit = exit;

    state: 'codeMode' | 'noCodeMode' = 'noCodeMode';
    constructor (private context: vscode.ExtensionContext) {
        const repo = context.globalState.get<vscode.Uri>('wt.codeMode.codeRepo');
        if (repo) {
            this.repoLocation = repo;
        //     setTimeout(() => {
        //         this.getRepoLeaves(repo).then(leaves => {
        //             this.repoUris = leaves
        //         });
        //     }, 1000);
        }

        vscode.commands.registerCommand('wt.codeMode.enterCodeMode', async () => {
            if (this.state !== 'noCodeMode') {
                vscode.window.showInformationMessage('[INFO] Cannot enter code mode when already in code mode!');
                return;
            }
            
            // Make sure there is a valid code repo to pick from
            const repoLocation = this.repoLocation || context.globalState.get<vscode.Uri>('wt.codeMode.codeRepo');
            if (!repoLocation) {
                const requestResult = await this.requestRepoLocation();
                if (!requestResult) return;
            }

            if (!this.repoUris) {
                this.repoUris = await this.getRepoLeaves(this.repoLocation!);
            }

            // Enter code mode
            this.enter();
        });

        vscode.commands.registerCommand('wt.codeMode.changeCodeModeRepo', async () => {
            const res = await this.requestRepoLocation();
            if (!res) {
                vscode.window.showErrorMessage('[ERR] An error occurred while reading code repo');
            }
        });
        
        vscode.commands.registerCommand('wt.codeMode.exitCodeMode', () => this.state === 'codeMode' && this.exit());
    }

    private async requestRepoLocation (): Promise<boolean> {
        const response = await vscode.window.showOpenDialog({
            title: 'To activate code mode, please specify the locatiom of a code repo you would like to read from . . . ',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select'
        });
        if (!response) return false;
        if (response.length === 0) return false;

        // Can select many above is turned to false, so there should only be one uri
        const repo = response[0];
        this.repoLocation = repo;

        const leaves = await this.getRepoLeaves(repo);
        if (leaves.length === 0) {
            // If the directory was empty, report the error and recurse
            vscode.window.showErrorMessage('[ERR] Code repo for code mode cannot be empty!');
            return this.requestRepoLocation();
        }
        this.repoUris = leaves;

        // Store the repo location in global state
        this.context.globalState.update('wt.codeMode.codeRepo', repo);
        return true;
    }

    private async getRepoLeaves (repo: vscode.Uri): Promise<vscode.Uri[]> {
        const visited: Set<vscode.Uri> = new Set();
        const leaves: vscode.Uri[] = [];
        const queue: vscode.Uri[] = [ repo ];
        while (queue) {
            const next = queue.shift();
            if (!next) break;                       // should never happen
            if (visited.has(next)) continue;        // never visit same dir again

            const dirContent = await vscode.workspace.fs.readDirectory(next);
            for (const [ name, fileType ] of dirContent) {
                const fullPath = vscode.Uri.from({
                    ...next,
                    path: next.path + '/' + name
                });
                // vscode.Uri.joinPath(next, name);
                
                if (fileType === vscode.FileType.Directory) {
                    queue.push(fullPath);
                } 
                else if (fileType === vscode.FileType.File) {
                    const buf = await vscode.workspace.fs.readFile(fullPath);
                    if (isText(null, Buff.from(buf))) {
                        leaves.push(fullPath);
                    }
                    // const ft = await fileTypeFromBuffer(buf);
                    // if (ft?.mime.startsWith('text')) {
                    // }
                }
            }
        }
        return leaves;
    }
};