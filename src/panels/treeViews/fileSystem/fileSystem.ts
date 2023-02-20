import * as vscode from 'vscode';
import * as fsFunctions from './fileSystemProviderFunctions';

export abstract class FileSystem implements vscode.FileSystemProvider {
    
	public abstract _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

    abstract watch: <T extends FileSystem>(this: T, uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }) => vscode.Disposable;
    abstract stat: <T extends FileSystem>(this: T, uri: vscode.Uri) => any;
    abstract readDirectory: <T extends FileSystem>(this: T, uri: vscode.Uri) => any;
    abstract createDirectory: <T extends FileSystem>(uri: vscode.Uri) => any;
    abstract readFile: <T extends FileSystem>(uri: vscode.Uri) => any;
    abstract writeFile: <T extends FileSystem>(this: T, uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }) => any;
    abstract delete: <T extends FileSystem>(uri: vscode.Uri, options: { recursive: boolean; }) => any;
    abstract rename: <T extends FileSystem>(this: T, oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }) => any;
}