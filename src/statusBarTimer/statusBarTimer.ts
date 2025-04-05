import * as vscode from 'vscode';

// new Date(SECONDS * 1000).toISOString().slice(11, 19);

export class StatusBarTimer {

    
    timerStatusItem: vscode.StatusBarItem;

    constructor (private context: vscode.ExtensionContext,) {
        this.timerStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000001);
        this.timerStatusItem.text = '00:00:00 (active)'
        this.timerStatusItem.command = 'wt.statusBarTimer.displayOptions';
        this.timerStatusItem.show();
        // this.startTimer();
        this.registerCommands();
        this.startTimer();
        this.context.subscriptions.push(this.timerStatusItem);
    }

    isCodeMode: boolean = false;
    isPaused: boolean = false;
    activeTimer: number = 0;
    private startTimer () {
        setInterval(() => {

            let pausedText: string | null = null;

            // Check if the timer timer should be paused
            if (this.isCodeMode)
                pausedText = 'In Code Mode';
            else if (this.isPaused)
                pausedText = 'Paused By User';
            else if (vscode.window.activeTextEditor === undefined) 
                pausedText = 'No Active Editor';
            else if (!vscode.window.state.focused) 
                pausedText = 'VS Code Window Unfocused';
            else {
                const currentDocument = vscode.window.activeTextEditor.document;
                const docName = currentDocument.fileName;
                const splt = docName.split('.');
                const docExtension = splt[splt.length - 1];
                if (docExtension !== 'wt') {
                    pausedText = "Document Ext Not 'wt'";
                }
            }
            

            // If there was a pausedText string created, then pause the timer and
            //      set the status string to the pause reason
            let statusString: string;
            if (pausedText !== null) {
                statusString = `Inactive - ${pausedText}`;
            }
            else {
                this.activeTimer += 1;
                statusString = 'active';
            }
            
            // Display any updates
            const timeStr = new Date(this.activeTimer * 1000).toISOString().slice(11, 19);
            this.timerStatusItem.text = `${timeStr} (${statusString})`;
            this.timerStatusItem.show()
        }, 1000);
    }

    private registerCommands () {
        this.context.subscriptions.push(vscode.commands.registerCommand('wt.statusBarTimer.displayOptions', async () => {

            const isActive = !this.isPaused;
            const firstOptionText = isActive ? 'Pause Timer' : 'Resume Timer';
            const response = await vscode.window.showQuickPick([ firstOptionText, 'Reset Timer', 'Show Timer rules' ], {
                canPickMany: false,
                ignoreFocusOut: false,
                placeHolder: firstOptionText,
                title: 'Timer Options'
            });
            if (response === undefined) return;

            if (response === firstOptionText) {
                if (isActive) {
                    this.isPaused = true;
                }
                else {
                    this.isPaused = false;
                }
            }
            else if (response === 'Reset Timer') {
                vscode.commands.executeCommand('wt.statusBarTimer.resetTimer');
            }
            else if (response === 'Show Timer rules') {
                vscode.commands.executeCommand('wt.statusBarTimer.showInfo');
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.statusBarTimer.showInfo', () => {
            vscode.window.showInformationMessage(
                "Session Timer Rules",
                {
                    modal: true,
                    detail: "Timer shows the amount of time you have spent on your current session.  Time does not progress when: \n  -  In code mode, \n  -  Focused out of VS Code, \n  -  Active document extension is not '.wt' (yes, not even '.wtnote' — world building is not writing), \n  -  Editor is not focused (reorganizing notes is not writing, either, sorry)."
                }
            )
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.statusBarTimer.resetTimer', () => {
            this.activeTimer = 0;
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.statusBarTimer.enteredCodeMode', () => {
            this.isCodeMode = true;
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('wt.statusBarTimer.exitedCodeMode', () => {
            this.isCodeMode = false;
        }));
    }
}