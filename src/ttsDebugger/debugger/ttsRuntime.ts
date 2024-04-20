/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { EventEmitter } from 'events';
import { speakText } from '../tts/tts';
// import * as console from './../../vsconsole';
import * as vscode from 'vscode'
import { WordMarker } from '../tts/windows';

export interface FileAccessor {
	isWindows: boolean;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export interface IRuntimeBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}


interface IRuntimeStackFrame {
	index: number;
	name: string;
	file: string;
	line: number;
	column?: number;
	instruction?: number;
}

interface IRuntimeStack {
	count: number;
	frames: IRuntimeStackFrame[];
}

interface RuntimeDisassembledInstruction {
	address: number;
	instruction: string;
	line?: number;
}

export type IRuntimeVariableType = number | boolean | string | RuntimeVariable[];

export class RuntimeVariable {
	private _memory?: Uint8Array;

	public reference?: number;

	public get value() {
		return this._value;
	}

	public set value(value: IRuntimeVariableType) {
		this._value = value;
		this._memory = undefined;
	}

	public get memory() {
		if (this._memory === undefined && typeof this._value === 'string') {
			this._memory = new TextEncoder().encode(this._value);
		}
		return this._memory;
	}

	constructor(public readonly name: string, private _value: IRuntimeVariableType) {}

	public setMemory(data: Uint8Array, offset = 0) {
		const memory = this.memory;
		if (!memory) {
			return;
		}

		memory.set(data, offset);
		this._memory = memory;
		this._value = new TextDecoder().decode(memory);
	}
}

interface Word {
	name: string;
	line: number;
	index: number;
}

export function timeout(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A TTS runtime with minimal debugger functionality.
 * TTSRuntime is a hypothetical (aka "TTS") "execution engine with debugging support":
 * it takes a Markdown (*.md) file and "executes" it by "running" through the text lines
 * and searching for "command" patterns that trigger some debugger related functionality (e.g. exceptions).
 * When it finds a command it typically emits an event.
 * The runtime can not only run through the whole file but also executes one line at a time
 * and stops on lines for which a breakpoint has been registered. This functionality is the
 * core of the "debugging support".
 * Since the TTSRuntime is completely independent from VS Code or the Debug Adapter Protocol,
 * it can be viewed as a simplified representation of a real "execution engine" (e.g. node.js)
 * or debugger (e.g. gdb).
 * When implementing your own debugger extension for VS Code, you probably don't need this
 * class because you can rely on some existing debugger or runtime.
 */
export class TTSRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	public _sourceFile: string = '';
	public get sourceFile() {
		return this._sourceFile;
	}

	public closed = false;
	private variables = new Map<string, RuntimeVariable>();

	// the contents (= lines) of the one and only file
	private sourceLines: string[] = [];
	private instructions: Word[] = [];
	private starts: number[] = [];
	private ends: number[] = [];

	// This is the next line that will be 'executed'
	private _currentLine = 0;
	private get currentLine() {
		return this._currentLine;
	}
	private set currentLine(x) {
		this._currentLine = x;
		this.instruction = this.starts[x];
	}
	private currentColumn: number | undefined;

	// This is the next instruction that will be 'executed'
	public instruction= 0;

	// maps from sourceFile to array of IRuntimeBreakpoint
	private breakPoints = new Map<string, IRuntimeBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private breakpointId = 1;

	private breakAddresses = new Map<string, string>();

	private namedException: string | undefined;
	private otherExceptions = false;

	public wordMarkerStream: WordMarker[] | null = null;

	constructor(private fileAccessor: FileAccessor) {
		super();
	}

	/**
	 * Start executing the given program.
	 */
	public async start(program: string, stopOnEntry: boolean, debug: boolean): Promise<{ start: boolean }> {

		await this.loadSource(this.normalizePathAndCasing(program));

		if (debug) {
			await this.verifyBreakpoints(this._sourceFile);

			
			if (this.breakPoints.size !== 0) {
				let targets: IRuntimeBreakpoint[] = [];
				this.breakPoints.forEach((val, key) => {
					if (key === program.toLocaleLowerCase()) {
						targets = val;
					}
				});
				targets.sort((a, b) => {
					return a.line - b.line;
				});
				const min = targets[0];
				this._currentLine = min.line - 1;
			}

			if (stopOnEntry) {
				this.findNextStatement(false, 'stopOnEntry');
				return { start: this.breakPoints.size === 0 }
			} 
			else {
				// we just start to run until we hit a breakpoint, an exception, or the end of the program
				this.continue(false);
				return { start: this.breakPoints.size === 0 }
			}
		} 
		else {
			this.continue(false);
			return { start: this.breakPoints.size === 0 }
		}
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	private continueHitMap: { [index: number]: boolean } = {};
	private breakNext = false;
	public async continue (reverse: boolean) {
		this.continueHitMap = {};
		while ((this._currentLine < this.sourceLines.length || this.breakNext) && !this.closed) {
			console.log(`HIT: ${this.currentLine}`);
			if (this.continueHitMap[this._currentLine]) {
				this._currentLine++;
				continue;
			}
			this.continueHitMap[this._currentLine] = true;
			if (this._currentLine === this.sourceFile.length - 1) {
				this.breakNext = true;
			}
			const exec = await this.executeLine(this.currentLine, reverse);
			if (this.updateCurrentLine(reverse)) {
				break;
			}
			if (this.findNextStatement(reverse)) {
				break;
			}
		}
		this.breakNext = false;
		this.closed = false;
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public async step (reverse: boolean) {
		// await new Promise((resolve) => setTimeout(resolve, 1000));
		if (!(await this.executeLine(this.currentLine, reverse))) {
			if (!this.updateCurrentLine(reverse)) {
				this.findNextStatement(reverse, 'stopOnStep');
			}
		}
	}

	private updateCurrentLine (reverse: boolean): boolean {
		if (reverse) {
			if (this.currentLine > 0) {
				this.currentLine--;
			} 
			else {
				// no more lines: stop at first line
				this.currentLine = 0;
				this.currentColumn = undefined;
				this.sendEvent('stopOnEntry');
				return true;
			}
		} 
		else {
			if (this.currentLine < this.sourceLines.length-1) {
				this.currentLine++;
			} 
			else {
				// no more lines: run to end
				this.currentColumn = undefined;
				this.sendEvent('end');
				return true;
			}
		}
		return false;
	}

	/*
	 * Determine possible column breakpoint positions for the given line.
	 * Here we return the start location of words with more than 8 characters.
	 */
	public getBreakpoints(path: string, line: number): number[] {
		return this.getWords(line, this.getLine(line)).filter(w => w.name.length > 8).map(w => w.index);
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public async setBreakPoint(path: string, line: number): Promise<IRuntimeBreakpoint> {
		path = this.normalizePathAndCasing(path);

		const bp: IRuntimeBreakpoint = { verified: false, line, id: this.breakpointId++ };
		let bps = this.breakPoints.get(path);
		if (!bps) {
			bps = new Array<IRuntimeBreakpoint>();
			this.breakPoints.set(path, bps);
		}
		bps.push(bp);

		await this.verifyBreakpoints(path);

		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number): IRuntimeBreakpoint | undefined {
		const bps = this.breakPoints.get(this.normalizePathAndCasing(path));
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				return bp;
			}
		}
		return undefined;
	}

	public clearBreakpoints(path: string): void {
		this.breakPoints.delete(this.normalizePathAndCasing(path));
	}

	public stack(startFrame: number, endFrame: number): IRuntimeStackFrame {
		const line = this.getLine();
		console.log(`LINE FOR STACK: ${line}`);

		const name = line.length > 23
			? `${line.substring(0, 20)}...`
			: line;

		return {
			index: 0,
			name: name,
			file: this._sourceFile,
			line: this.currentLine,
			column: 0,
		};
	}

	// private methods

	private getLine(line?: number): string {
		return this.sourceLines[line === undefined ? this.currentLine : line].trim();
	}

	private getWords(l: number, line: string): Word[] {
		// break line into words
		const WORD_REGEXP = /[a-z]+/ig;
		const words: Word[] = [];
		let match: RegExpExecArray | null;
		while (match = WORD_REGEXP.exec(line)) {
			words.push({ name: match[0], line: l, index: match.index });
		}
		return words;
	}

	private async loadSource(file: string): Promise<void> {
		if (this._sourceFile !== file) {
			this._sourceFile = this.normalizePathAndCasing(file);
			this.initializeContents(await this.fileAccessor.readFile(file));
		}
	}

	private initializeContents(memory: Uint8Array) {
		this.sourceLines = new TextDecoder().decode(memory).split(/\r?\n/);

		this.starts = [];
		this.instructions = [];
		this.ends = [];

		for (let l = 0; l < this.sourceLines.length; l++) {
			this.starts.push(this.instructions.length);
			const words = this.getWords(l, this.sourceLines[l]);
			for (let word of words) {
				this.instructions.push(word);
			}
			this.ends.push(this.instructions.length);
		}
	}

	/**
	 * return true on stop
	 */
	 private findNextStatement(reverse: boolean, stepEvent?: string): boolean {

		for (let ln = this.currentLine; reverse ? ln >= 0 : ln < this.sourceLines.length; reverse ? ln-- : ln++) {

			// is there a source breakpoint?
			const breakpoints = this.breakPoints.get(this._sourceFile);
			if (breakpoints) {
				const bps = breakpoints.filter(bp => bp.line === ln);
				if (bps.length > 0) {

					// send 'stopped' event
					this.sendEvent('stopOnBreakpoint');

					// the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
					// if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
					if (!bps[0].verified) {
						bps[0].verified = true;
						this.sendEvent('breakpointValidated', bps[0]);
					}

					this.currentLine = ln;
					return true;
				}
			}

			const line = this.getLine(ln);
			if (line.length > 0) {
				this.currentLine = ln;
				break;
			}
		}
		if (stepEvent) {
			this.sendEvent(stepEvent);
			return true;
		}
		return false;
	}

	/**
	 * "execute a line" of the readme markdown.
	 * Returns true if execution sent out a stopped event and needs to stop.
	 */
	private async executeLine(ln: number, reverse: boolean): Promise<boolean> {
		const line = this.getLine(ln);
		if (line === '') return false;

		this.wordMarkerStream = [];
		await speakText(line, (wordMarker) => {
			console.log(wordMarker);
			this.sendEvent('stopped', {
				reason: 'breakpoint',
				threadId: 1
			});
			this.wordMarkerStream?.push(wordMarker);
		});

		// nothing interesting found -> continue
		return false;
	}

	private async verifyBreakpoints(path: string): Promise<void> {

		const bps = this.breakPoints.get(path);
		if (bps) {
			await this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && bp.line < this.sourceLines.length) {
					const srcLine = this.getLine(bp.line);

					// if a line is empty or starts with '+' we don't allow to set a breakpoint but move the breakpoint down
					if (srcLine.length === 0 || srcLine.indexOf('+') === 0) {
						bp.line++;
					}
					// if a line starts with '-' we don't allow to set a breakpoint but move the breakpoint up
					if (srcLine.indexOf('-') === 0) {
						bp.line--;
					}
					// don't set 'verified' to true if the line contains the word 'lazy'
					// in this case the breakpoint will be verified 'lazy' after hitting it once.
					if (srcLine.indexOf('lazy') < 0) {
						bp.verified = true;
						this.sendEvent('breakpointValidated', bp);
					}
				}
			});
		}
	}

	private sendEvent(event: string, ... args: any[]): void {
		setTimeout(() => {
			this.emit(event, ...args);
		}, 0);
	}

	private normalizePathAndCasing(path: string) {
		if (this.fileAccessor.isWindows) {
			return path.replace(/\//g, '\\').toLowerCase();
		} 
		else {
			return path.replace(/\\/g, '/');
		}
	}
}
