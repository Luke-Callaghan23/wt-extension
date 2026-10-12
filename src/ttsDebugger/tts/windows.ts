import * as vscode from 'vscode';
import * as childProcess from "child_process";
import { getPowershellCommand } from "./windowsCommand";

type DefaultCallback = ((err: Error | null)=>void) | null | undefined;
export type WordMarker = { wordCount: number, characterPosition: number, characterCount: number, spokenText: string };

const COMMAND = 'powershell';
export class WindowsSpeak {
    private speakProcess: childProcess.ChildProcessWithoutNullStreams | null;
    private miscProcess: childProcess.ChildProcessWithoutNullStreams | null;
    private baseSpeed: number;
    constructor () {
        this.speakProcess = null
        this.miscProcess = null;
        this.baseSpeed = 0
    }

    // Every live speak process, so overlapping speaks can all be stopped
    // track every child process so stop() can cancel overlapping speech
    private speakProcesses = new Set<childProcess.ChildProcessWithoutNullStreams>();

    speak (
        text: string, 
        voice: string | null, 
        speed: number,
        onWord?: (wordMarker: WordMarker)=>void
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!text) {
                return setImmediate(() => {
                    reject(new TypeError('say.speak(): must provide text parameter'))
                })
            }

            const psCommand = getPowershellCommand(text, this.convertSpeed(speed), voice || "");
            // Encode the script so spoken text is passed as data, not shell syntax.
            const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');
            const proc = childProcess.spawn('powershell', [ '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded ]);
            this.speakProcess = proc;
            this.speakProcesses.add(proc);
            proc.stderr.setEncoding('utf8');
            proc.stdout.setEncoding('utf8');

            let killed = false;
            (proc as any).__stopped = () => { killed = true; };
            let stderr = '';
            proc.stderr.on('data', (data: string) => { stderr += data; });

            // stdout chunks can contain partial or multiple lines, one JSON object per line
            // stdout chunks may split or combine the JSON marker lines
            let buffer = '';
            const handleLine = (line: string) => {
                line = line.trim();
                if (!line) return;
                try {
                    onWord?.(JSON.parse(line) as WordMarker);
                }
                catch (e) {
                    // ignore non-marker output
                }
            };
            proc.stdout.on('data', (data: string) => {
                console.log(data);
                buffer += data;
                let nl: number;
                while ((nl = buffer.indexOf('\n')) >= 0) {
                    handleLine(buffer.substring(0, nl));
                    buffer = buffer.substring(nl + 1);
                }
            });

            proc.on('error', (err) => {
                console.log('error', err);
                // Remove failed processes so later stop calls only target live speech.
                this.speakProcesses.delete(proc);
                if (this.speakProcess === proc) this.speakProcess = null;
                reject(err);
            });
    
            proc.on('exit', (code, signal) => {
                console.log('exit', code, signal);
                // Flush a final marker that may not end with a newline.
                this.speakProcesses.delete(proc);
                if (this.speakProcess === proc) this.speakProcess = null;
                handleLine(buffer);
                if (killed) {
                    return resolve();
                }
                if (code !== 0) {
                    return reject(new Error(`TTS could not talk, had an error [code: ${code}] [signal: ${signal}] ${stderr}`));
                }
                resolve();
            });
        });
    }

    // Kills all running speech.  Resolves even if nothing is speaking.
    // stop all speech processes; this resolves immediately if none are active
    stop (): Promise<void> {
        for (const proc of this.speakProcesses) {
            (proc as any).__stopped?.();
            this.killProcess(proc);
        }
        this.speakProcesses.clear();
        this.speakProcess = null;
        return Promise.resolve();
    }

    private killProcess (proc: childProcess.ChildProcessWithoutNullStreams) {
        try {
            proc.stdin.destroy();
        }
        catch (e) {}
        if (proc.pid !== undefined) {
            childProcess.exec(`taskkill /pid ${proc.pid} /T /F`, () => {});
        }
    }

    getInstalledVoices (): Promise<string | null> {
        return new Promise<string | null>((resolve, reject) => {
            let { command, args } = this.getVoices()
            let voicesStr: string = '';
            let voices: string[] = [];
            this.miscProcess = childProcess.spawn(command, args);
    
            this.miscProcess.stderr.setEncoding('ascii');
    
            this.miscProcess.stderr.once('data', (data) => {
                // we can't stop execution from this function
                reject(new Error(data));
            })
            this.miscProcess.stdout.on('data', function (data) {
                voicesStr += data
            })
    
            this.miscProcess.addListener('exit', (code, signal) => {
                if (code === null || signal !== null) {
                    return reject(new Error(`say.getInstalledVoices(): could not get installed voices, had an error [code: ${code}] [signal: ${signal}]`));
                }
    
                if (voicesStr.length > 0) {
                    voices = voicesStr.split('\r\n');
                    voices = (voices[voices.length - 1] === '') ? voices.slice(0, voices.length - 1) : voices;
                }
                this.miscProcess = null;
                resolve(voicesStr);
            })
    
            this.miscProcess.stdin.end();
        })
    }


    runStopCommand () {
        return this.stop();
    }

    convertSpeed (speed: number): number {
        // Overriden to map playback speed (as a ratio) to Window's values (-10 to 10, zero meaning x1.0)
        if (!(speed > 0)) return 0;
        return Math.max(-10, Math.min(Math.round((9.0686 * Math.log(speed)) - 0.1806), 10))
    }

    getVoices () {
        let args = []
        let psCommand = 'Add-Type -AssemblyName System.speech;$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;$speak.GetInstalledVoices() | % {$_.VoiceInfo.Name}'
        args.push(psCommand)
        return { command: COMMAND, args }
    }
}
