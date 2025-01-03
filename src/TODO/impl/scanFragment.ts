/* eslint-disable curly */
import * as console from '../../miscTools/vsconsole';
import * as extension from '../../extension';
import * as vscode from 'vscode';
import { FragmentNode } from '../node';
import { Validation, TODO } from '../TODOsView';

type IncompleteTODO = {
    rowStart: number,
    colStart: number,
    content: string,
};

export async function scanFragment(uri: vscode.Uri, fragmentNode: FragmentNode): Promise<[ Validation, number ]> {
    const finishedTODOs: TODO[] = [];
    const unfinishedTodoStack: IncompleteTODO[] = [];
    
    // Read the fragment file and split on newlines
    let fragmentBuffer;
    try {
        fragmentBuffer = await vscode.workspace.fs.readFile(uri);
    }
    catch {
        return [ { type: 'invalid' }, 0 ];
    }
    const fragmentDecoded = extension.decoder.decode(fragmentBuffer);
    const fragmentStream = fragmentDecoded.split(/\r?\n/);

    // Scan over every row and column of the file
    for (let row = 0; row < fragmentStream.length; row++) {
        const paragraph = fragmentStream[row];
        for (let col = 0; col < paragraph.length; col++) {
            const char = paragraph[col];
            if (char === '[') {
                // If the current character is a '[', we interpret that as the start of 
                //      a TODO
                // But we don't know where the end of the TODO is, so add a new 
                //      unfinished TODO to the stack of unfinished TODOs
                // The next ']' will be interpreted as the end of the TOD
                unfinishedTodoStack.push({
                    rowStart: row,
                    colStart: col,
                    content: ''
                });
            }
            else if (char === ']') {
                // Pop the latest unfinished TODO from the stack and (if it exists), finish
                //      the TODO struct with the current scan position, and push the 
                //      finished TODO to the todo stack
                const unfinished = unfinishedTodoStack.pop();
                if (!unfinished) continue;
                unfinished.content += char;
                finishedTODOs.push({
                    rowStart: unfinished.rowStart,
                    colStart: unfinished.colStart,
                    rowEnd: row,
                    colEnd: col + 1,
                    preview: unfinished.content,
                });
            }
            for (const unfinished of unfinishedTodoStack) {
                unfinished.content += char;
            }
        }
    }

    // Create and return validated structure, as well as a count of
    //      all the TODOs in this fragment
    const fragmentsTODOs: Validation = {
        type: 'todos',
        data: finishedTODOs
    };
    const fragmentTODOsCount = finishedTODOs.length;
    return [ fragmentsTODOs, fragmentTODOsCount ];
}