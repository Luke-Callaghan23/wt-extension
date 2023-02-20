
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as console from './../../../vsconsole';
import { FileStat, _ } from './fileSystemDefault';
import { FileSystem } from './fileSystem';

export function watch<T extends FileSystem>(this: T, uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
	const watcher = fs.watch(uri.fsPath, { recursive: options.recursive }, 
		async (event: string, filename: string | Buffer) => {
			const filepath = path.join(uri.fsPath, _.normalizeNFC(filename.toString()));
			this._onDidChangeFile.fire([{
				type: event === 'change' ? vscode.FileChangeType.Changed : await _.exists(filepath) ? vscode.FileChangeType.Created : vscode.FileChangeType.Deleted,
				uri: uri.with({ path: filepath })
			} as vscode.FileChangeEvent]);
		}
	);

	return { dispose: () => watcher.close() };
}

export function stat<T extends FileSystem>(this: T, uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
	return _stat(this, uri.fsPath);
}

async function _stat<T extends FileSystem>(_this: T, path: string): Promise<vscode.FileStat> {
	return new FileStat(await _.stat(path));
}

export function readDirectory<T extends FileSystem>(this: T, uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
	return _readDirectory(this, uri);
}

async function _readDirectory<T extends FileSystem>(_this: T, uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
	const children = await _.readdir(uri.fsPath);

	const result: [string, vscode.FileType][] = [];
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		const stat = await _stat(_this, path.join(uri.fsPath, child));
		result.push([child, stat.type]);
	}

	return Promise.resolve(result);
}

export function createDirectory<T extends FileSystem>(uri: vscode.Uri): void | Thenable<void> {
	return _.mkdir(uri.fsPath);
}

export function readFile<T extends FileSystem>(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
	return _.readfile(uri.fsPath);
}

export function writeFile<T extends FileSystem>(this: T, uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
	return _writeFile(this, uri, content, options);
}

async function _writeFile<T extends FileSystem>(_this: T, uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
	const exists = await _.exists(uri.fsPath);
	if (!exists) {
		if (!options.create) {
			throw vscode.FileSystemError.FileNotFound();
		}

		await _.mkdir(path.dirname(uri.fsPath));
	} else {
		if (!options.overwrite) {
			throw vscode.FileSystemError.FileExists();
		}
	}

	return _.writefile(uri.fsPath, content as Buffer);
}

export function deleteFile<T extends FileSystem>(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
	if (options.recursive) {
		return _.rmrf(uri.fsPath);
	}

	return _.unlink(uri.fsPath);
}

export function renameFile<T extends FileSystem>(this: T, oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
	return _rename(this, oldUri, newUri, options);
}

async function _rename<T extends FileSystem>(_this: T, oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
	const exists = await _.exists(newUri.fsPath);
	if (exists) {
		if (!options.overwrite) {
			throw vscode.FileSystemError.FileExists();
		} else {
			await _.rmrf(newUri.fsPath);
		}
	}

	const parentExists = await _.exists(path.dirname(newUri.fsPath));
	if (!parentExists) {
		await _.mkdir(path.dirname(newUri.fsPath));
	}

	return _.rename(oldUri.fsPath, newUri.fsPath);
}