import * as vscode from 'vscode';
import * as console from '../../miscTools/vsconsole';
import { Fetch } from '../../Fetch/fetchSource';

export async function queryVery (word: string): Promise<string[] | null> {
    try {
        const JSDOM = require('jsdom').JSDOM;
        // Fetch losethevery.com to get synonyms for the very word
        const response: Response = await Fetch(`https://www.losethevery.com/another-word/very-${word}`);
        if (!response || !response.body) return null;
        const buff = await response.arrayBuffer()
        const jsdom = new JSDOM(buff)

        // Current structure of losethevery elements to get similar words is
        //      ...junk.../main/div/a/targets
        const main = jsdom.window.document.querySelector('main');       // <main>
        const container = main?.querySelector('div');                   //      <div>
        const words = container?.querySelectorAll('a');                 //          <a>, <a>, ..., <a>
        if (!words || Object.entries(words).length === 0) return null;

        // Map all <a> elements to the text inside
        const wordElements = [ ...words ];
        return wordElements.map(({ text }) => text.trim().toLocaleLowerCase());
    }
    catch (e) {
        console.log(`Error: ${e}`);
        return null;
    }
}