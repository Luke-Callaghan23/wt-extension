import * as vscode from 'vscode';
import { CoderModer } from './codeMode';
import { Buff } from '../Buffer/bufferSource';
import { isText } from 'istextorbinary';
import { TabLabels } from '../tabLabels/tabLabels';
import { OutlineView } from '../outline/outlineView';
import { NotebookPanel } from '../notebook/notebookPanel';
import { ExtensionGlobals } from '../extension';
import { SearchBarView } from '../search/searchBarView';
import { SearchResultsView } from '../search/searchResultsView';

export async function enter (this: CoderModer): Promise<void> {


    if (!this.repoUris) return;

    this.openedCodeUris = [];

    let idx = 0;
    this.repoUris = this.repoUris.sort(() => 0.5 - Math.random());
    
    // Will store all the promises for opening repo documents
    const shownDocumentPromises: Thenable<any>[] = [];

    // Iterate over every tab group and open a document from the chosen repo there
    for (const group of vscode.window.tabGroups.all) {
        
        // Select a random uri from this.repoUris to open in this tab group
        const uri = this.repoUris[idx++];
        this.openedCodeUris.push(uri);
        
        // Open the text docoument in the current view column
        const targetLocation = group.viewColumn;
        const showRepoDocumentPromise = vscode.window.showTextDocument(uri, {
            viewColumn: targetLocation,
        });
        shownDocumentPromises.push(showRepoDocumentPromise);

        if (group.isActive && group.activeTab && group.activeTab.input instanceof vscode.TabInputText) {
            this.previousActiveViewColumn = targetLocation;
            this.previousActiveDocument = group.activeTab.input.uri;
        }
    }

    
    const outlineView: OutlineView = ExtensionGlobals.outlineView;
    const searchBarView: SearchBarView = ExtensionGlobals.searchBarView;
    const searchResultsView: SearchResultsView = ExtensionGlobals.searchResultsView;
    
    if (outlineView.view.visible) {
        this.activityBarSwitchedFrom = 'outline';
    }
    else if (searchBarView.isVisible() || searchResultsView.getUpdatesAreVisible()) {
        this.activityBarSwitchedFrom = 'search';
    }
    else {
        this.activityBarSwitchedFrom = 'none';
    }
    
    if (this.activityBarSwitchedFrom !== 'none') {
        vscode.commands.executeCommand('workbench.view.explorer');
    }

    const notebookView: NotebookPanel = ExtensionGlobals.notebookPanel;
    if (notebookView.view.visible) {
        vscode.commands.executeCommand('workbench.action.output.toggleOutput');
        this.openedOutput = true;
    }
    

    this.state = 'codeMode';

    // Once all the document promises have been resolved, we can clear away the names of the .wt documents
    Promise.all(shownDocumentPromises).then(() => {
        setTimeout(TabLabels.clearNamesForAllTabs, 0);
    })
}

/*


$mid: 1
authority: 'wsl+ubuntu'
path: '/home/luke-callaghan/dev/node/vscode/vscode-extension-samples/tree-view-sample/node_modules/resolve-from/license'
scheme: 'vscode-remote'

*/