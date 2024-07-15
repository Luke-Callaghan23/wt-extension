import * as vscode from 'vscode';
import { enter } from './enterCodeMode';
import { exit } from './exitCodeMode';
import * as console from '../vsconsole';
import { isText } from 'istextorbinary';
// import { fileTypeFromBuffer, fileTypeFromStream } from 'file-type';
import { Buff } from '../Buffer/bufferSource';

export type CodeModeState = 'codeMode' | 'noCodeMode';
export class CoderModer {

    openedExplorer: boolean = false;
    openedOutput: boolean = false;
    previousActiveViewColumn: vscode.ViewColumn | null;
    previousActiveDocument: vscode.Uri | null;


    swapModeStatus: vscode.StatusBarItem;

    repoLocation: vscode.Uri | undefined;
    repoUris: vscode.Uri[] | undefined;
    openedCodeUris: vscode.Uri[] = [];

    enter = enter;
    exit = exit;

    state: CodeModeState = 'noCodeMode';
    constructor (private context: vscode.ExtensionContext) {
        this.swapModeStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000000);
        this.swapModeStatus.text = this.state === 'codeMode' ? 'Turn Off Code Mode' : 'Turn On Code Mode';
        this.swapModeStatus.command = 'wt.codeMode.swapMode';
        this.swapModeStatus.show();

        const repo = context.workspaceState.get<vscode.Uri>('wt.codeMode.codeRepo');
        const repoUris = context.workspaceState.get<vscode.Uri[]>('wt.codeMode.repoUris');
        if (repo) {
            this.repoLocation = repo;
            if (!repoUris) (async () => {
                this.repoUris = await this.getRepoLeaves(repo);
                context.workspaceState.update('wt.codeMode.repoUris', this.repoUris);
                vscode.window.showInformationMessage('[INFO] Loaded Code Mode . . . ');
            })();
        }
        
        if (repoUris) {
            // If repo uris were read from global state, vscode automatically converts their scheme
            //      to vscode-remote, but we need 'file' uris
            // So, remap all uris to file uris
            this.repoUris = repoUris.map(({ path }) => {
                return vscode.Uri.from({
                    scheme: 'file',
                    path: path
                });
            });
        }
        this.previousActiveDocument = null;
        this.previousActiveViewColumn = null

        vscode.commands.registerCommand('wt.codeMode.enterCodeMode', async () => {
            if (this.state !== 'noCodeMode') {
                vscode.window.showInformationMessage('[INFO] Cannot enter code mode when already in code mode!');
                return;
            }
            
            // Make sure there is a valid code repo to pick from
            const repo = this.repoLocation || context.workspaceState.get<vscode.Uri>('wt.codeMode.codeRepo');
            if (!repo) {
                const requestResult = await this.requestRepoLocation();
                if (!requestResult) return;

                const { repoLocation, repoUris } = requestResult;
                this.repoLocation = repoLocation;
                this.repoUris = repoUris;

                // Store the repo location and leaves in global state
                this.context.workspaceState.update('wt.codeMode.codeRepo', repoLocation);
                this.context.workspaceState.update('wt.codeMode.repoUris', repoUris);
            }

            if (!this.repoUris) {
                this.repoUris = await this.getRepoLeaves(this.repoLocation!);
                context.workspaceState.update('wt.codeMode.repoUris', this.repoUris);
                vscode.window.showInformationMessage('[INFO] Loaded Code Mode . . . ');
            }

            // Enter code mode
            await this.enter();
            vscode.window.showInformationMessage(`[INFO] Entered Code Mode`);
            vscode.commands.executeCommand('wt.statusBarTimer.enteredCodeMode');
        });

        vscode.commands.registerCommand('wt.codeMode.changeCodeModeRepo', async () => {
            const res = await this.requestRepoLocation();
            if (!res) {
                vscode.window.showErrorMessage('[ERR] An error occurred while reading code repo');
                return;
            }
            const { repoLocation, repoUris } = res;
            this.repoLocation = repoLocation;
            this.repoUris = repoUris;
            this.context.workspaceState.update('wt.codeMode.codeRepo', repoLocation);
            this.context.workspaceState.update('wt.codeMode.repoUris', repoUris);
            vscode.window.showInformationMessage(`[INFO] Changed Repo`);
        });
        
        vscode.commands.registerCommand('wt.codeMode.exitCodeMode', async () => {
            if (this.state !== 'codeMode') return;
            await this.exit();
            vscode.window.showInformationMessage(`[INFO] Exited Code Mode`);
            vscode.commands.executeCommand('wt.statusBarTimer.exitedCodeMode');
        });
        
        vscode.commands.registerCommand('wt.codeMode.swapMode', async () => {
            if (this.state === 'noCodeMode') {
                await vscode.commands.executeCommand('wt.codeMode.enterCodeMode');
            }
            else {
                await vscode.commands.executeCommand('wt.codeMode.exitCodeMode');
            }
            this.swapModeStatus.text = this.state === 'codeMode' ? 'Turn Off Code Mode' : 'Turn On Code Mode';
            this.swapModeStatus.show();
        });

        vscode.commands.registerCommand('wt.codeMode.getMode', () => this.state);
    }

    private async requestRepoLocation (): Promise<{
        repoLocation: vscode.Uri,
        repoUris: vscode.Uri[]
    } | null> {
        const response = await vscode.window.showOpenDialog({
            title: 'To activate code mode, please specify the locatiom of a code repo you would like to read from . . . ',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select'
        });
        if (!response) return null;
        if (response.length === 0) return null;

        // Can select many above is turned to false, so there should only be one uri
        const repo = response[0];

        const leaves = await this.getRepoLeaves(repo);
        if (leaves.length === 0) {
            // If the directory was empty, report the error and recurse
            vscode.window.showErrorMessage('[ERR] Code repo for code mode cannot be empty!');
            return this.requestRepoLocation();
        }
        return {
            repoLocation: repo,
            repoUris: leaves
        };
    }

    private async getRepoLeaves (repo: vscode.Uri): Promise<vscode.Uri[]> {
        const visited: Set<vscode.Uri> = new Set();
        const leaves: vscode.Uri[] = [];
        const queue: vscode.Uri[] = [ repo ];
        while (queue.length > 0) {
            // queue.sort((a, b) => 0.5 - Math.random());
            // if (leaves.length > 50) break;          // useless to get more thant 100 leaves
            const next = queue.shift();
            if (!next) break;                       // should never happen
            if (visited.has(next)) continue;        // never visit same dir again

            const dirContent = await vscode.workspace.fs.readDirectory(next);
            for (const [ name, fileType ] of dirContent) {
                if (name === '.git' || name === 'notde_modules') continue;
                const fullPath = vscode.Uri.from({
                    ...next,
                    path: next.path + '/' + name
                });

                if (fileType === vscode.FileType.Directory) {
                    queue.push(fullPath);
                } 
                else if (fileType === vscode.FileType.File) {
                    const buf = await vscode.workspace.fs.readFile(fullPath);
                    if (isText(null, Buff.from(buf))) {
                        leaves.push(fullPath);
                    }
                }
            }
        }
        return leaves;
    }
};