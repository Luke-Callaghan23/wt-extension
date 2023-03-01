/* eslint-disable curly */

import * as vscode from 'vscode';

export namespace _ {

	function handleResult<T>(
		resolve: (result: T) => void, 
		reject: (error: Error) => void, 
		error: Error | null | undefined, 
		result: T
	): void {
		if (error) {
			reject(massageError(error));
		} else {
			resolve(result);
		}
	}

	function massageError(error: Error & { code?: string }): Error {
		if (error.code === 'ENOENT') {
			return vscode.FileSystemError.FileNotFound();
		}

		if (error.code === 'EISDIR') {
			return vscode.FileSystemError.FileIsADirectory();
		}

		if (error.code === 'EEXIST') {
			return vscode.FileSystemError.FileExists();
		}

		if (error.code === 'EPERM' || error.code === 'EACCESS') {
			return vscode.FileSystemError.NoPermissions();
		}

		return error;
	}

	export function checkCancellation(token: vscode.CancellationToken): void {
		if (token.isCancellationRequested) {
			console.log('if (token.isCancellationRequested) {');
			throw new Error('Operation cancelled');
		}
	}

	export function normalizeNFC(items: string): string;
	export function normalizeNFC(items: string[]): string[];
	export function normalizeNFC(items: string | string[]): string | string[] {
		console.log('export function normalizeNFC(items: string | string[]): string | string[] {');
		throw new Error('Not implemented');
		// if (process.platform !== 'darwin') {
		// 	return items;
		// }

		// if (Array.isArray(items)) {
		// 	return items.map(item => item.normalize('NFC'));
		// }

		// return items.normalize('NFC');
	}

	export function readdir(path: string): Promise<string[]> {
		console.log('export function readdir(path: string): Promise<string[]> {');
		throw new Error('Not implemented');
		// return new Promise<string[]>((resolve, reject) => {
		// 	fs.readdir(path, (error, children) => handleResult(resolve, reject, error, normalizeNFC(children)));
		// });
	}

	export function stat(path: string): Promise<any> {
		console.log('export function stat(path: string): Promise<any> {');
		throw new Error('Not implemented');
		// return new Promise<fs.Stats>((resolve, reject) => {
		// 	fs.stat(path, (error, stat) => handleResult(resolve, reject, error, stat));
		// });
	}

	export function readfile(path: string): Promise<Buffer> {
		console.log('export function readfile(path: string): Promise<Buffer> {');
		throw new Error('Not implemented');
		// return new Promise<Buffer>((resolve, reject) => {
		// 	fs.readFile(path, (error, buffer) => handleResult(resolve, reject, error, buffer));
		// });
	}

	export function writefile(path: string, content: Buffer): Promise<void> {
		console.log('export function writefile(path: string, content: Buffer): Promise<void> {');
		throw new Error('Not implemented');
	// 	return new Promise<void>((resolve, reject) => {
	// 		fs.writeFile(path, content, error => handleResult(resolve, reject, error, void 0));
	// 	});
	}

	export function exists(path: string): Promise<boolean> {
		console.log('export function exists(path: string): Promise<boolean> {');
		throw new Error('Not implemented');
		// return new Promise<boolean>((resolve, reject) => {
		// 	fs.exists(path, exists => handleResult(resolve, reject, null, exists));
		// });
	}

	export function rmrf(path: string): Promise<void> {
		console.log('export function rmrf(path: string): Promise<void> {');
		throw new Error('Not implemented');
	}

	export function mkdir(path: string): Promise<void> {
		console.log('export function mkdir(path: string): Promise<void> {');
		throw new Error('Not implemented');
	}

	export function rename(oldPath: string, newPath: string): Promise<void> {
		console.log('export function rename(oldPath: string, newPath: string): Promise<void> {');
		throw new Error('Not implemented');
		// return new Promise<void>((resolve, reject) => {
		// 	fs.rename(oldPath, newPath, error => handleResult(resolve, reject, error, void 0));
		// });
	}

	export function unlink(path: string): Promise<void> {
		console.log('export function unlink(path: string): Promise<void> {');
		throw new Error('Not implemented');
		// return new Promise<void>((resolve, reject) => {
		// 	fs.unlink(path, error => handleResult(resolve, reject, error, void 0));
		// });
	}
}

export class FileStat implements vscode.FileStat {

	constructor(private fsStat: vscode.FileStat) { }

	get type(): vscode.FileType {
		return this.fsStat.type === vscode.FileType.File ? vscode.FileType.File : this.fsStat.type === vscode.FileType.Directory ? vscode.FileType.Directory : this.fsStat.type === vscode.FileType.SymbolicLink ? vscode.FileType.SymbolicLink : vscode.FileType.Unknown;
	}

	get isFile(): boolean | undefined {
		return this.fsStat.type === vscode.FileType.File;
	}

	get isDirectory(): boolean | undefined {
		return this.fsStat.type === vscode.FileType.Directory;
	}

	get isSymbolicLink(): boolean | undefined {
		return this.fsStat.type === vscode.FileType.SymbolicLink;
	}

	get size(): number {
		return this.fsStat.size;
	}

	get ctime(): number {
		return this.fsStat.ctime;
	}

	get mtime(): number {
		return this.fsStat.mtime;
	}
}
