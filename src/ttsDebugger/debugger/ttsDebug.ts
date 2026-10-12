/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/*
 * ttsDebug.ts implements the Debug Adapter that "adapts" or translates the Debug Adapter Protocol (DAP) used by the client (e.g. VS Code)
 * into requests and events of the real "execution engine" or "debugger" (here: class TtsRuntime).
 * When implementing your own debugger extension for VS Code, most of the work will go into the Debug Adapter.
 * Since the Debug Adapter is independent from VS Code, it can be used in any client (IDE) supporting the Debug Adapter Protocol.
 *
 * The most important class of the Debug Adapter is the TtsDebugSession which implements many DAP requests by talking to the TtsRuntime.
 */

import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, ContinuedEvent, BreakpointEvent, OutputEvent,
    ProgressStartEvent, ProgressUpdateEvent, ProgressEndEvent, InvalidatedEvent,
    StackFrame, Scope, Source, Handles, Breakpoint,
    Thread
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { basename } from 'path-browserify';
import { TTSRuntime, IRuntimeBreakpoint, FileAccessor, RuntimeVariable, timeout, IRuntimeVariableType } from './ttsRuntime';

//@ts-ignore
import { Subject } from 'await-notify';
import { stopSpeaking } from '../tts/tts';
import { WordMarker } from '../tts/windows';
import * as console from '../../miscTools/vsconsole';
import * as vscode from 'vscode';

/**
 * This interface describes the tts-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the tts-debug extension.
 * The interface should always match this schema.
 */
interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
    /** enable logging the Debug Adapter Protocol */
    trace?: boolean;
    /** run without debugging */
    noDebug?: boolean;
    /** if specified, results in a simulated compile error in launch. */
    compileError?: 'default' | 'show' | 'hide';
}

interface IAttachRequestArguments extends ILaunchRequestArguments { }


export class TTSDebugSession extends LoggingDebugSession {

    // we don't support multiple threads, so we can use a hardcoded ID for the default thread
    private static threadID = 1;

    // a Tts runtime (or debugger)
    private _runtime: TTSRuntime;

    private _variableHandles = new Handles<'locals' | 'globals' | RuntimeVariable>();

    private _configurationDone = new Subject();

    private _cancellationTokens = new Map<number, boolean>();

    private _reportProgress = false;
    private _progressId = 10000;
    private _cancelledProgressId: string | undefined = undefined;
    private _isProgressCancellable = true;

    private _valuesInHex = false;
    private _useInvalidatedEvent = false;

    private _addressesInHex = true;

    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    public constructor(fileAccessor: FileAccessor) {
        super("tts-debug.txt");

        // this debugger uses zero-based lines and columns
        this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);

        this._runtime = new TTSRuntime(fileAccessor);

        // setup event handlers
        this._runtime.on('running', () => {
            // tell VS Code the session is running while word decorations track speech
            this.sendEvent(new ContinuedEvent(TTSDebugSession.threadID, true));
        });
        this._runtime.on('wordSpoken', (line: number, marker: WordMarker) => {
            // move the editor marker while speech is running without stopping the debug session
            this.highlightWord(line, marker);
        });
        this._runtime.on('stopOnEntry', () => {
            this.clearWordHighlight();
            this.sendEvent(new StoppedEvent('entry', TTSDebugSession.threadID));
        });
        this._runtime.on('stopOnStep', () => {
            this.clearWordHighlight();
            this.sendEvent(new StoppedEvent('step', TTSDebugSession.threadID));
        });
        this._runtime.on('stopOnBreakpoint', () => {
            this.clearWordHighlight();
            this.sendEvent(new StoppedEvent('breakpoint', TTSDebugSession.threadID));
        });
        this._runtime.on('stopOnInstructionBreakpoint', () => {
            this.sendEvent(new StoppedEvent('instruction breakpoint', TTSDebugSession.threadID));
        });
        this._runtime.on('breakpointValidated', (bp: IRuntimeBreakpoint) => {
            this.sendEvent(new BreakpointEvent('changed', { verified: bp.verified, id: bp.id } as DebugProtocol.Breakpoint));
        });
        this._runtime.on('output', (type, text, filePath, line, column) => {

            let category: string;
            switch(type) {
                case 'prio': category = 'important'; break;
                case 'out': category = 'stdout'; break;
                case 'err': category = 'stderr'; break;
                default: category = 'console'; break;
            }
            const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}\n`, category);

            if (text === 'start' || text === 'startCollapsed' || text === 'end') {
                e.body.group = text;
                e.body.output = `group-${text}\n`;
            }

            e.body.source = this.createSource(filePath);
            e.body.line = this.convertDebuggerLineToClient(line);
            e.body.column = this.convertDebuggerColumnToClient(column);
            this.sendEvent(e);
        });
        this._runtime.on('end', () => {
            this.clearWordHighlight();
            stopSpeaking();
            this.sendEvent(new TerminatedEvent());
        });
    }

    private _program = '';
    // Highlight the active word separately from the moving gutter arrow.
    private _wordDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground')
    });
    private _arrowDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground'),
        gutterIconPath: vscode.Uri.parse('data:image/svg+xml;utf8,' + encodeURIComponent(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='#FFCC00' d='M2 5h6V2l6 6-6 6v-3H2z'/></svg>"
        )),
        gutterIconSize: 'contain'
    });

    private programEditors(): vscode.TextEditor[] {
        const program = this._program.toLowerCase();
        // only decorate the file being spoken
        return vscode.window.visibleTextEditors.filter(e => e.document.uri.fsPath.toLowerCase() === program);
    }

    private highlightWord(line: number, marker: WordMarker): void {
        // marker positions are measured against the source text
        const range = new vscode.Range(line, marker.characterPosition, line, marker.characterPosition + marker.spokenText.length);
        for (const editor of this.programEditors()) {
            editor.setDecorations(this._wordDecoration, [range]);
            editor.setDecorations(this._arrowDecoration, [new vscode.Range(line, 0, line, 0)]);
        }
    }

    private clearWordHighlight(): void {
        for (const editor of this.programEditors()) {
            editor.setDecorations(this._wordDecoration, []);
            editor.setDecorations(this._arrowDecoration, []);
        }
    }

    /**
     * The 'initialize' request is the first request called by the frontend
     * to interrogate the features the debug adapter provides.
     */
    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

        if (args.supportsProgressReporting) {
            this._reportProgress = true;
        }
        if (args.supportsInvalidatedEvent) {
            this._useInvalidatedEvent = true;
        }

        // build and return the capabilities of this debug adapter:
        response.body = response.body || {};

        // the adapter implements the configurationDone request.
        response.body.supportsConfigurationDoneRequest = true;

        // make VS Code show a 'step back' button
        response.body.supportsStepBack = true;

        // make VS Code send cancel request
        response.body.supportsCancelRequest = true;

        // make VS Code send the breakpointLocations request
        response.body.supportsBreakpointLocationsRequest = true;

        response.body.supportSuspendDebuggee = true;
        response.body.supportTerminateDebuggee = true;
        response.body.supportsDelayedStackTraceLoading = true;

        this.sendResponse(response);

        // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
        // we request them early by sending an 'initializeRequest' to the frontend.
        // The frontend will end the configuration sequence by calling 'configurationDone' request.
        this.sendEvent(new InitializedEvent());
    }

    /**
     * Called at the end of the configuration sequence.
     * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
     */
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);

        // notify the launchRequest that configuration has finished
        this._configurationDone.notify();
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): Promise<void> {
        console.log(`disconnectRequest suspend: ${args.suspendDebuggee}, terminate: ${args.terminateDebuggee}`);
        await this._runtime.dispose();
        this.clearWordHighlight();
        this._wordDecoration.dispose();
        this._arrowDecoration.dispose();
        this.sendResponse(response);
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: IAttachRequestArguments) {
        return this.launchRequest(response, args);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {

        // make sure to 'Stop' the buffered logging if 'trace' is not set
        logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

        // wait 1 second until configuration has finished (and configurationDoneRequest has been called)
        await this._configurationDone.wait(1000);

        // start the program in the runtime
        this._program = args.program;
        const { start } = await this._runtime.start(args.program, !!args.stopOnEntry, !args.noDebug);

        if (args.compileError) {
            // simulate a compile/build error in "launch" request:
            // the error should not result in a modal dialog since 'showUser' is set to false.
            // A missing 'showUser' should result in a modal dialog.
            this.sendErrorResponse(response, {
                id: 1001,
                format: `compile error: some fake error.`,
                showUser: args.compileError === 'show' ? true : (args.compileError === 'hide' ? false : undefined)
            });
        } 
        else {
            this.sendResponse(response);
            // if (start) {
            //     setTimeout(() => {
            //         vscode.commands.executeCommand('workbench.action.debug.continue');
            //     }, 500);
            // }
        }
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {

        const path = args.source.path as string;
        // Accept modern column breakpoints and the legacy line-only field.
        const requested = args.breakpoints ?? (args.lines ?? []).map(line => ({ line } as DebugProtocol.SourceBreakpoint));

        // clear all breakpoints for this file
        this._runtime.clearBreakpoints(path);

        // set and verify breakpoint locations
        const actualBreakpoints0 = requested.map(async r => {
            // Convert DAP coordinates before storing the runtime breakpoint.
            const column = r.column === undefined ? undefined : this.convertClientColumnToDebugger(r.column);
            const { verified, line, id, column: actualColumn } = await this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(r.line), column);
            const bp = new Breakpoint(
                verified,
                this.convertDebuggerLineToClient(line),
                actualColumn === undefined ? undefined : this.convertDebuggerColumnToClient(actualColumn)
            ) as DebugProtocol.Breakpoint;
            bp.id = id;
            return bp;
        });
        const actualBreakpoints = await Promise.all<DebugProtocol.Breakpoint>(actualBreakpoints0);

        // send back the actual breakpoint positions
        response.body = {
            breakpoints: actualBreakpoints
        };
        this.sendResponse(response);
    }

    protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {

        if (args.source.path) {
            // Report punctuation positions so the editor offers inline breakpoints there.
            const bps = this._runtime.getBreakpoints(args.source.path, this.convertClientLineToDebugger(args.line));
            response.body = {
                breakpoints: bps.map(col => {
                    return {
                        line: args.line,
                        column: this.convertDebuggerColumnToClient(col)
                    };
                })
            };
        } 
        else {
            response.body = {
                breakpoints: []
            };
        }
        this.sendResponse(response);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        // this runtime has no variables
        response.body = { scopes: [] };
        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        response.body = { allThreadsContinued: true };
        this.sendResponse(response);
        // Start speech after replying; the run completes asynchronously.
        this._runtime.continue(false);
    }

    protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
        this.sendResponse(response);
        this._runtime.continue(true);
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.sendResponse(response);
        this._runtime.step(false);
    }

    protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
        this.sendResponse(response);
        this._runtime.step(true);
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
        this.sendResponse(response);
        this._runtime.pause();
    }

    private async progressSequence() {

        const ID = '' + this._progressId++;

        await timeout(100);

        const title = this._isProgressCancellable ? 'Cancellable operation' : 'Long running operation';
        const startEvent: DebugProtocol.ProgressStartEvent = new ProgressStartEvent(ID, title);
        startEvent.body.cancellable = this._isProgressCancellable;
        this._isProgressCancellable = !this._isProgressCancellable;
        this.sendEvent(startEvent);
        this.sendEvent(new OutputEvent(`start progress: ${ID}\n`));

        let endMessage = 'progress ended';

        for (let i = 0; i < 100; i++) {
            await timeout(500);
            this.sendEvent(new ProgressUpdateEvent(ID, `progress: ${i}`));
            if (this._cancelledProgressId === ID) {
                endMessage = 'progress cancelled';
                this._cancelledProgressId = undefined;
                this.sendEvent(new OutputEvent(`cancel progress: ${ID}\n`));
                break;
            }
        }
        this.sendEvent(new ProgressEndEvent(ID, endMessage));
        this.sendEvent(new OutputEvent(`end progress: ${ID}\n`));

        this._cancelledProgressId = undefined;
    }

    protected cancelRequest (response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
        if (args.requestId) {
            this._cancellationTokens.set(args.requestId, true);
        }
        if (args.progressId) {
            this._cancelledProgressId= args.progressId;
        }
        this.sendResponse(response);
    }

    protected customRequest (command: string, response: DebugProtocol.Response, args: any) {
        if (command === 'skipToBreakpoint') {
            // This request backs the running-session F5 shortcut.
            this._runtime.continue(false, true);
            this.sendResponse(response);
        }
        else if (command === 'toggleFormatting') {
            this._valuesInHex = ! this._valuesInHex;
            if (this._useInvalidatedEvent) {
                this.sendEvent(new InvalidatedEvent( ['variables'] ));
            }
            this.sendResponse(response);
        } 
        else {
            super.customRequest(command, response, args);
        }
    }

    protected setExceptionBreakPointsRequest (response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
        this.sendResponse(response);
    }
    protected exceptionInfoRequest (response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments) {
        this.sendErrorResponse(response, { id: 1002, format: 'No exception info available' });
    }
    protected threadsRequest (response: DebugProtocol.ThreadsResponse): void {
        // runtime supports no threads so just return a default thread.
        response.body = {
            threads: [
                new Thread(TTSDebugSession.threadID, "Speaking"),
            ]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest (response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
        const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
        const endFrame = startFrame + maxLevels;

        const stk = this._runtime.stack(startFrame, endFrame);
        const stackFrame: DebugProtocol.StackFrame = new StackFrame(
            stk.index, stk.name, 
            this.createSource(stk.file), this.convertDebuggerLineToClient(stk.line)
        );

        if (this._runtime.wordMarkerStream && this._runtime.wordMarkerStream.length > 0) {
            const latest = this._runtime.wordMarkerStream[this._runtime.wordMarkerStream.length - 1];
            const start = latest.characterPosition;
            const end = latest.characterPosition + latest.spokenText.length;

            stackFrame.column = start + 1;
            stackFrame.endColumn = end + 1;
            stackFrame.name = latest.spokenText;
        }

        response.body = {
            stackFrames: [ stackFrame ],
            totalFrames: 1
        };
        this.sendResponse(response);
    }

    //---- helpers

    

    private createSource(filePath: string): Source {
        return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'tts-adapter-data');
    }
}

