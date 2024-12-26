import {
    Logger, logger,
    DebugSession, LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent,
    Thread, StackFrame, Scope, Source, Breakpoint
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { ChildProcess } from 'child_process';
import { basename, normalize, join, isAbsolute } from 'path';

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {

    // Non-optional arguments are guaranteed to be defined in extension.ts: resolveDebugConfiguration().
    argsString: string;
    args: string[];
    env: object;
    cwd: string;
    cwdEffective: string;
    program: string;
    programEffective: string;
    pathBash: string;
    pathBashdb: string;
    pathBashdbLib: string;
    pathCat: string;
    pathMkfifo: string;
    pathPkill: string;
    terminalKind?: 'integrated' | 'external' | 'debugConsole';
    showDebugOutput?: boolean;
    /** enable logging the Debug Adapter Protocol */
    trace?: boolean;
}

export class BashDebugSession extends LoggingDebugSession {

}