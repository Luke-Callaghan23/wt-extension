import * as childProcess from "child_process"
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
    
            const psCommand = getPowershellCommand(text, speed);
            this.speakProcess = childProcess.spawn('powershell', [ psCommand ]);
            this.speakProcess.stderr.setEncoding('ascii');
    
            this.speakProcess.stderr.once('data', (data) => {
                reject(new Error(data));
            });
    
            this.speakProcess.stdout.on('data', (data: string) => {
                const txt = data.toString();
                const wordMarker: WordMarker = JSON.parse(txt);
                onWord?.(wordMarker);
            });
    
            this.speakProcess.addListener('exit', (code, signal) => {
                if (code === null || signal !== null) {
                    return reject(new Error(`TTS could not talk, had an error [code: ${code}] [signal: ${signal}]`))
                }
                this.speakProcess = null;
                resolve();
            });
        });
    }

    stop (): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.speakProcess) {
                return setImmediate(() => {
                    reject(new Error('No speech to kill'));
                })
            }
    
            this.runStopCommand();
            this.speakProcess = null;
            resolve();
        });
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
        if (!this.speakProcess) return;
        this.speakProcess.stdin.destroy();
        childProcess.exec(`taskkill /pid ${this.speakProcess.pid} /T /F`)
    }

    convertSpeed (speed: number): number {
        // Overriden to map playback speed (as a ratio) to Window's values (-10 to 10, zero meaning x1.0)
        return Math.max(-10, Math.min(Math.round((9.0686 * Math.log(speed)) - 0.1806), 10))
    }

    getVoices () {
        let args = []
        let psCommand = 'Add-Type -AssemblyName System.speech;$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;$speak.GetInstalledVoices() | % {$_.VoiceInfo.Name}'
        args.push(psCommand)
        return { command: COMMAND, args }
    }
}
