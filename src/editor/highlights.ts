import * as vscode from 'vscode';
import { defaultJumpFragmentOptions, fragmentStopReg, jumpParagraph, jumpSentence, jumpWord, punctuationStopsReg } from './jumps';

export async function highlightWord () {
    await jumpWord('forward', false);                           // Jump forward
    await jumpWord('backward', true);                           // Jump backward holding shift
}

export async function highlightSentence (sentenceJumpReg: RegExp = punctuationStopsReg) {
    await jumpSentence('forward', false, {
        punctuationStops: sentenceJumpReg
    });                      // Jump forward
    await jumpSentence('backward', true, {
        punctuationStops: sentenceJumpReg
    });                      // Jump backward holding shift
}

export async function highlightParagraph () {
    await jumpParagraph('forward', false);                      // Jump forward
    await jumpParagraph('backward', true);                      // Jump backward holding shift
}

export async function highlightFragment (fragmentJumpReg: RegExp = fragmentStopReg) {
    await jumpSentence('forward', false, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    });                 
    await jumpSentence('backward', true, { 
        punctuationStops: punctuationStopsReg,
        fragmentStops: fragmentJumpReg
    });                 
}