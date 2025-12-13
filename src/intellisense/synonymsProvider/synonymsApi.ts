import * as console from '../../miscTools/vsconsole';
// const fetch = require('node-fetch-commonjs');
import { Fetch } from '../../Fetch/fetchSource';
import { queryVery } from '../very/veryQuery';
import { Definition, SynonymError, SynonymSearchResult, Synonyms } from './provideSynonyms';
import { __ } from '../../miscTools/help';


process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'


export class QuerySynonyms {
    constructor (private apiKey: string) {}

    private parseList (defs: (string | string[])[]): string[] {
        const ret: string[] = [];
        for (const def of defs) {
            if (def instanceof Array) {
                const newList = this.parseList(def);
                for (const item of newList) {
                    ret.push(item);
                }
            }
            else {
                ret.push(def);
            }
        }
        return ret;
    }
    
    private async querySynonymsApi (word: string): Promise<SynonymSearchResult> {
        try {
            word = word.toLowerCase();
            // @ts-ignore
            const api = `https://dictionaryapi.com/api/v3/references/thesaurus/json/${word}?key=${this.apiKey}`;
            const resp: Response = await Fetch(api);
            
            if (!resp || resp.status !== 200) {
                return  {
                    type: 'error',
                    message: "Could not connect to dictionary API.  Please check your internet connection."
                };
            }
            const json = await resp.json();
        
            if (typeof json[0] === 'string' || json.length === 0) {
                const arr: string[] = json;
                let suggestions = arr.slice(0, -1).map((str: string) => `'*${str}*'`).join(', ');
                suggestions += (`, or '*${arr[arr.length - 1]}*'`)
                return {
                    type: 'error',
                    message: `### Word not recognized by dictionary API.\n\n\nDid you mean: \n\n\n${suggestions}?`,
                    suggestions: arr,
                };
            }
        
            const definitions: Definition[] = json.map((definition: any) => ({
                'definitions' :  this.parseList(definition[ 'shortdef' ]),
                'part'        :  definition[ 'fl' ],
                'synonyms'    :  this.parseList(definition[ 'meta' ][ 'syns' ]),
                'antonyms'    :  this.parseList(definition[ 'meta' ][ 'ants' ]),
            }));
    
            // Get only the unique definitions -- where uniqueness is defined as
            //      having a unique first entry in the defintions array
            // Sort all defintions into a map where their first definition is the key
            //      and the index latest entry of the Definition item with that definition
            //      is the value
            const defMap: { [index: string]: number } = {};
            definitions.forEach((def, index) => {
                defMap[def.definitions[0]] = index;
            });
            const definitionSet = Object.entries(defMap).map(([ _, index ]) => definitions[index]);
        
            return {
                type: 'success',
                provider: "synonymsApi",
                word: word,
                definitions: definitionSet
            };
        }
        catch (e) {
            return {
                type: 'error',
                message: "Could not connect to dictionary API.  Please check your internet connection."
            };
        }
    }
    
    private async queryWordHippo (words: string[] | string): Promise<SynonymSearchResult> {
        try {
            
            let phrase;
            if (words instanceof Array) {
                phrase = words.join('_').toLowerCase();
            }
            else {
                phrase = words.toLowerCase()
            }
        
            let text;
            try {
                const response = await Fetch(`https://www.wordhippo.com/what-is/another-word-for/${phrase}.html`);
                text = await response.text();
            }
            catch (err: any) {
                return {
                    type: 'error',
                    message: `An error occurred while querying word hippo: ${err}`
                };
            }
    
    
            const JSDOM = require('jsdom').JSDOM;
            const parser = new JSDOM(text);
            const doc = parser.window.document;
            const partsOfSpeech = doc.querySelectorAll('.wordtype');
            const descriptions = doc.querySelectorAll('.tabdesc');
            const allRelated = doc.querySelectorAll(".relatedwords");
        
            // { partOfSpeech: string, description: string, relatePhrases: string[] }[]
            const definitions: Definition[] = [];
        
            for (let defIndex = 0; defIndex < allRelated.length; defIndex++) {
                let pos = partsOfSpeech[defIndex]?.textContent?.replaceAll(/[^\w]/g, '')?.toLowerCase();
                if (pos === 'nearbywords') {
                    pos = 'Nearby Words';
                }
                const desc = descriptions[defIndex]?.textContent?.trim();
                const related = allRelated[defIndex];
                const phrases = [...related.querySelectorAll('.wb'), ...related.querySelectorAll('.wordblock')]
                const relatedPhrases = phrases.map(p => {
                    const txt: string = p.textContent;
                    if (txt.endsWith('UK')) {
                        return [];
                    }
                    else if (txt.endsWith('US')) {
                        return txt.replace('US', '');
                    }
                    return txt;
                }).flat();
                definitions.push({
                    part: pos || '',
                    definitions: [ desc || '' ],
                    synonyms: relatedPhrases,
                    antonyms: [],
                })
            }
    
            // If the word was not recognized by word hippo, then query the dictionary API instead
            if (text.includes("/what-is/recaptcha.bot")) {
                console.log('captchad')
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.queryWordHippo(phrase);
            }
            if (definitions.length === 0) {
                throw 'not good';
                // return null;
                // return this.querySynonymsApi(phrase);
            }
            else if (definitions.length === 1) {
                const onlyDef = definitions[0];
                if (onlyDef.part === 'Nearby Words') {
                    return __<SynonymError>({
                        type: 'error',
                        message: "Word Hippo was unable to find any synonyms for this word.",
                        suggestions: onlyDef.synonyms
                    });
                }
            }

            return {
                type: 'success',
                provider: 'wh',
                word: phrase,
                definitions: definitions
            }
        }
        catch (e: any) {
            console.log(`Error: ${e}`);
            return {
                type: 'error',
                message: `${e.message}`,
            };
        }
    }

    async getSynonym (word: string, provider: 'wh' | 'synonymsApi'): Promise<SynonymSearchResult> {
        console.log(`Searching provider API '${provider}' for word '${word}'`);
        if (provider === 'wh') {
            return this.queryWordHippo(word);
        }
        else {
            return this.querySynonymsApi(word);
        }
    }
}


