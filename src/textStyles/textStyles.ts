/* eslint-disable curly */
import * as vscode from 'vscode';
import { Workspace } from '../workspace/workspaceClass';
import * as console from '../miscTools/vsconsole';
import { Packageable } from '../packageable';
import { Timed } from '../timedView';
import * as extension from '../extension';
import { update, disable, italicsDecoration, boldDecoration, underlineDecoration, strikethroughDecoration  } from './timer';
import { hexToRgb } from '../miscTools/help';

export class TextStyles implements Timed {
    enabled: boolean;
    update = update;
    disable = disable;
    public wasUpdated: boolean = true;
	constructor(
        public context: vscode.ExtensionContext,
        public workspace: Workspace,
    ) {
        // Will later be modified by TimedView
        this.enabled = true;
        this.registerCommands();
        this.context.subscriptions.push(italicsDecoration);
        this.context.subscriptions.push(boldDecoration);
        this.context.subscriptions.push(underlineDecoration);
        this.context.subscriptions.push(strikethroughDecoration);
	}

    getUpdatesAreVisible(): boolean {
        return true;
    }

    registerCommands () {

	}
}