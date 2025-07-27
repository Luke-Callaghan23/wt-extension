/* eslint-disable curly */
import * as console from '../../miscTools/vsconsole';
import * as extension from '../../extension';
import * as vscode from 'vscode';
import { FragmentNode } from '../node';
import { Validation, TODO } from '../TODOsView';
import { getSurroundingTextInRange } from '../../miscTools/help';

type IncompleteTODO = {
    rowStart: number,
    colStart: number,
    content: string,
    offset: number,
};

export async function scanFragment(uri: vscode.Uri, fragmentNode: FragmentNode): Promise<[ Validation, number ]> {
    const finishedTODOs: TODO[] = [];
    const unfinishedTodoStack: IncompleteTODO[] = [];
    
    // Read the fragment file and split on newlines
    let doc: vscode.TextDocument;
    try {
        doc = await vscode.workspace.openTextDocument(uri);
    }
    catch {
        return [ { type: 'invalid' }, 0 ];
    }

    const fullText = doc.getText();

    // Scan over every row and column of the file
    for (let offset = 0; offset < fullText.length; offset++) {

        const char = fullText[offset];
        const position = doc.positionAt(offset);

        if (char === '[') {
            // If the current character is a '[', we interpret that as the start of 
            //      a TODO
            // But we don't know where the end of the TODO is, so add a new 
            //      unfinished TODO to the stack of unfinished TODOs
            // The next ']' will be interpreted as the end of the TOD
            unfinishedTodoStack.push({
                rowStart: position.line,
                colStart: position.character,
                content: '',
                offset: offset,
            });
        }
        else if (char === ']') {
            // Pop the latest unfinished TODO from the stack and (if it exists), finish
            //      the TODO struct with the current scan position, and push the 
            //      finished TODO to the todo stack
            const unfinished = unfinishedTodoStack.pop();
            if (!unfinished) continue;
            unfinished.content += char;
    
            
            const smallSurrounding = getSurroundingTextInRange(fullText, unfinished.offset, offset + 1, [ 20, 100 ]);
            const largerSurrounding = getSurroundingTextInRange(fullText, unfinished.offset, offset + 1, 400);
    
            finishedTODOs.push({
                rowStart: unfinished.rowStart,
                colStart: unfinished.colStart,
                rowEnd: position.line,
                colEnd: position.character,
                preview: unfinished.content,

                location: new vscode.Location(uri, new vscode.Range(doc.positionAt(unfinished.offset), position)),
                largerSurrounding: largerSurrounding.surroundingText,
                largerSurroundingHighlight: largerSurrounding.highlight,
                surroundingText: smallSurrounding.surroundingText,
                surroundingTextHighlight: smallSurrounding.highlight
            });
        }
        for (const unfinished of unfinishedTodoStack) {
            unfinished.content += char;
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