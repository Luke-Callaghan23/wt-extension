/* eslint-disable curly */
import * as vscode from 'vscode';
// import * as console from '../../vsconsole';
import { Ids } from '../../outlineProvider/fsNodes';
import { TODOData, TODONode } from '../node';
import { v4 as uuidv4 } from 'uuid';
import { TODOsView, Validation } from '../TODOsView';
import { ExtensionGlobals } from '../../extension';
import { getFsPathKey } from '../../miscTools/help';

export async function convertToTODOData (this: TODONode): Promise<TODONode[]> {
    const todos = getFsPathKey<Validation>(this.getUri(), TODOsView.todo)!;
    if (todos.type !== 'todos') throw new Error('Not possible');
    
    // Convert each of this fragment's TODOs into a TODOData struct
    //      and then into a TODO Node
    // Store the created TODO nodes in the global map for TODO ndoes
    return todos.data.map((data, index) => {
        const todoData: TODOData = {
            // Create TODOData from this TODO
            ids: {
                display: data.preview,
                uri: this.getUri(),
                type: 'fragment',
                fileName: this.data.ids.fileName,
                relativePath: this.data.ids.relativePath,
                ordering: index,
                parentTypeId: 'fragment',                       // note how the type id of the parent of this TODO Data node 
                                                                //      is 'fragment' as well as the type of the data node itself
                                                                //      is also 'fragment' -- this is how TODO Data nodes will be 
                                                                //      uniquely identified as such
                parentUri: this.getUri(),
            },
            todo: data,
        } as TODOData;
        return new TODONode(todoData);
    });;
}