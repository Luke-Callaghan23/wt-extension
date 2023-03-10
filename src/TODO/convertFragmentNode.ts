/* eslint-disable curly */
import * as vscode from 'vscode';
import * as console from '../vsconsole';
import { Ids } from '../outlineProvider/fsNodes';
import { TODOData, TODONode } from './TODONode';
import { isInvalidated, todo, todoNodes } from './TODOsView';
import { v4 as uuidv4 } from 'uuid';

export function convertToTODOData (this: TODONode): TODONode[] {
    const uri = this.getUri().fsPath;
    if (!isInvalidated(uri) && todoNodes[uri]) {
        return todoNodes[uri];
    }

    const todos = todo[uri];
    if (!todos) throw new Error('Not possible');
    if (todos.type === 'count') throw new Error('Not possible');
    
    // Convert each of this fragment's TODOs into a TODOData struct
    //      and then into a TODO Node
    const createdNodes = todos.data.map((data, index) => {
        const todoData: TODOData = {
            // Create TODOData from this TODO
            ids: {
                display: data.preview,
                type: 'fragment',
                fileName: this.data.ids.fileName,
                relativePath: this.data.ids.relativePath,
                ordering: index,
                internal: `dummy-${uuidv4()}`,      // .TODOData all have them same internal id: 'dummy',
                                                    //      this is used to differentiate between a
                                                    //      fragment and that fragments' TODO data
                parentTypeId: 'fragment',
                parentInternalId: this.data.ids.internal,
            },
            todo: data,
        } as TODOData;
        return new TODONode(todoData);
    });

    // Store the created TODO nodes in the global map for TODO ndoes
    todoNodes[uri] = createdNodes;
    return createdNodes;
}