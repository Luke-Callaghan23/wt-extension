import * as vscode from 'vscode';
import * as vscodeUris from 'vscode-uri';
import { OutlineTreeProvider } from "../../outlineProvider/outlineTreeProvider";
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from "../node";
import { readDotConfig, writeDotConfig } from '../../help';
import { HasGetUri, UriBasedView } from '../../outlineProvider/UriBasedView';

// Shifts all the nodes that 
export async function shiftTrailingNodesDown<T extends HasGetUri> (
    this: OutlineNode,
    view: UriBasedView<T>
): Promise<string> {

    // Read the .config file of this node from disk
    const parentDotConfig = vscodeUris.Utils.joinPath(this.data.ids.parentUri, '.config');
    const oldDotConfig = await readDotConfig(parentDotConfig);
    if (!oldDotConfig) {
        vscode.window.showErrorMessage(`Error: could not read .config file at path '${parentDotConfig}'.  Please do not mess with the file system of a IWE environment!`);
        throw new Error('Unable to retrieve .config data');
    }
    
    // Shift any node that comes after this one down by one inside of the disk config file
    const thisConfig = oldDotConfig[this.data.ids.fileName];
    Object.getOwnPropertyNames(oldDotConfig).forEach(fileName => {
        const record = oldDotConfig[fileName];
        if (record.ordering > thisConfig.ordering) {
            record.ordering -= 1;
        }
    });

    // Save the changes of the config file to disk
    const movedTitle = oldDotConfig[this.data.ids.fileName].title;
    delete oldDotConfig[this.data.ids.fileName];
    const writePromise = writeDotConfig(parentDotConfig, oldDotConfig);

    // Shift any node that comes after this one down by one inside of the internal 
    //      outline view tree structure
    const parentContainer: OutlineNode | null | undefined = await view.getTreeElementByUri(this.data.ids.parentUri);
    if (parentContainer) {
        // Find the content array in which this node resides
        let content: OutlineNode[];
        switch (parentContainer.data.ids.type) {
            case 'chapter': case 'snip':
                content = (parentContainer.data as ChapterNode | SnipNode).textData;
                break;
            case 'container':
                content = (parentContainer.data as ContainerNode).contents;
                break;
            default: throw new Error("Not Possible");
        }

        // Shift any node that comes after this one
        for (const node of content) {
            if (node.data.ids.ordering > thisConfig.ordering) {
                node.data.ids.ordering -= 1;
            }
        }
    }

    // Make sure the save finishes and then return the title of the moved content
    await writePromise;
    return movedTitle;
}