import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as extension from '../../extension';
import { Extension } from '../../extension';
import * as readline from 'readline';
import { glob } from 'glob';
import {promisify} from 'util'
import { isSubdirectory } from '../help';
import { nodeGrep, nodeGrepExtensionDirectory } from './nodeGrep';

export const captureGroupId = 'searchResult';



export async function grepSingleFile (
    uri: vscode.Uri,
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[vscode.Location, string][] | null> {
    const document = await vscode.workspace.openTextDocument(uri);
    return nodeGrep(document, searchBarValue, useRegex, caseInsensitive, wholeWord, cancellationToken);
}


export async function grepExtensionDirectory (
    searchBarValue: string, 
    useRegex: boolean, 
    caseInsensitive: boolean, 
    wholeWord: boolean,
    cancellationToken: vscode.CancellationToken
): Promise<[ vscode.Location, string ][] | null>  {
    return nodeGrepExtensionDirectory(searchBarValue, useRegex, caseInsensitive, wholeWord, cancellationToken);
}