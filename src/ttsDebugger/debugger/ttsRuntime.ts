/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { EventEmitter } from 'events';
import { speakText, stopSpeaking } from '../tts/tts';
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

        this.closed = false;
        this._sourceFile = '';
        await this.loadSource(this.normalizePathAndCasing(program));
        this.currentLine = 0;

        if (debug) {
            await this.verifyBreakpoints(this._sourceFile);

            const targets = [...(this.breakPoints.get(this._sourceFile) ?? [])].sort((a, b) => a.line - b.line);
            if (targets.length > 0) {
                this.currentLine = Math.max(0, Math.min(targets[0].line, this.sourceLines.length - 1));
            }

            if (stopOnEntry) {
                this.findNextStatement(false, 'stopOnEntry');
                return { start: this.breakPoints.size === 0 };
            } 
        }

        // run until we hit a breakpoint or the end of the program
        await this.continue(false);
        return { start: this.breakPoints.size === 0 };
    }

    // Each run (continue/step) gets a token; bumping the token cancels the active run
    private runToken = 0;
    private activeRun: Promise<void> = Promise.resolve();

    private isCancelled(token: number): boolean {
        return token !== this.runToken || this.closed;
    }

    /**
     * Cancel whatever is currently running (and speaking), then start the new run in the background.
     * Resolves once the new run has been started, not when it finishes.
     */
    private async startRun(run: (token: number) => Promise<void>): Promise<void> {
        const token = ++this.runToken;
        await stopSpeaking().catch(() => {});
        await this.activeRun;
        if (token !== this.runToken || this.closed) {
            return;
        }
        this.activeRun = run(token).catch(err => {
            console.log(`TTS run failed: ${err}`);
            if (!this.isCancelled(token)) {
                this.sendEvent('stopOnStep');
            }
        });
    }

    /**
     * Stops speaking and any active run without sending a stopped event.
     */
    public async cancelRun(): Promise<void> {
        this.runToken++;
        await stopSpeaking().catch(() => {});
        await this.activeRun;
    }

    public async pause(): Promise<void> {
        await this.cancelRun();
        this.sendEvent('stopOnStep');
    }

    public async dispose(): Promise<void> {
        this.closed = true;
        await this.cancelRun();
    }

    /**
     * Continue execution to the end/beginning.
     */
    public continue (reverse: boolean): Promise<void> {
        return this.startRun(async token => {
            while (!this.isCancelled(token)) {
                await this.executeLine(this.currentLine, token);
                if (this.isCancelled(token)) return;
                if (this.updateCurrentLine(reverse)) return;
                if (this.findNextStatement(reverse)) return;
            }
        });
    }

    /**
     * Step to the next/previous non empty line.
     */
    public step (reverse: boolean): Promise<void> {
        return this.startRun(async token => {
            await this.executeLine(this.currentLine, token);
            if (this.isCancelled(token)) return;
            if (!this.updateCurrentLine(reverse)) {
                this.findNextStatement(reverse, 'stopOnStep');
            }
        });
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
        return (this.sourceLines[line === undefined ? this.currentLine : line] ?? '').trim();
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
     * "execute a line": speak it, publishing a word event for every word spoken.
     * Speaks the raw (untrimmed) line so word positions are columns in the source line.
     */
    private async executeLine(ln: number, token: number): Promise<void> {
        const raw = this.sourceLines[ln] ?? '';
        if (raw.trim() === '') return;

        this.wordMarkerStream = [];
        await speakText(raw, (wordMarker) => {
            if (this.isCancelled(token)) return;
            this.wordMarkerStream?.push(wordMarker);
            this.sendEvent('stopped');
        });

        // the finished line no longer has a current word
        if (!this.isCancelled(token)) {
            this.wordMarkerStream = null;
        }
    }

    private async verifyBreakpoints(path: string): Promise<void> {

        const bps = this.breakPoints.get(path);
        if (bps) {
            await this.loadSource(path);
            bps.forEach(bp => {
                if (!bp.verified && bp.line < this.sourceLines.length) {
                    // breakpoints on empty lines move down to the next line with text
                    while (bp.line < this.sourceLines.length - 1 && this.getLine(bp.line).length === 0) {
                        bp.line++;
                    }
                    bp.verified = true;
                    this.sendEvent('breakpointValidated', bp);
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
