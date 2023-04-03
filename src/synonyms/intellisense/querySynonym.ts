import * as console from './../../vsconsole';
const fetch = require('node-fetch-commonjs');

type Definition = {
    definitions :  string[],
    part        :  string,
    synonyms    :  string[],
    antonyms    :  string[],
};

type Synonyms = {
    type: 'success',
    word: string,
    definitions: Definition[]
};

type SynonymError = {
    type: 'error',
    message: string,
    suggestions?: string[]
}

function parseList (defs: (string | string[])[]): string[] {
    const ret: string[] = [];
    for (const def of defs) {
        if (def instanceof Array) {
            const newList = parseList(def);
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


export async function query (word: string): Promise<Synonyms | SynonymError> {
    try {
        word = word.toLowerCase();
        // @ts-ignore
        const api = `https://dictionaryapi.com/api/v3/references/thesaurus/json/${word}?key=29029b50-e0f1-4be6-ac00-77ab8233e66b`;
        const resp: Response = await fetch(api);
        
        if (!resp || resp.status !== 200) return <SynonymError> {
            type: 'error',
            message: "Could not connect to dictionary API.  Please check your internet connection."
        };
        const json = await resp.json();
    
        if (typeof json[0] === 'string' || json.length === 0) {
            const arr: string[] = json;
            let suggestions = arr.slice(0, -1).map((str: string) => `'*${str}*'`).join(', ');
            suggestions += (`, or '*${arr[arr.length - 1]}*'`)
            return <SynonymError>{
                type: 'error',
                message: `### Word not recognized by dictionary API.\n\n\nDid you mean: \n\n\n${suggestions}?`,
                suggestions: arr,
            };
        }
    
    
        const definitions: Definition[] = json.map((definition: any) => ({
            'definitions' :  parseList(definition[ 'shortdef' ]),
            'part'        :  definition[ 'fl' ],
            'synonyms'    :  parseList(definition[ 'meta' ][ 'syns' ]),
            'antonyms'    :  parseList(definition[ 'meta' ][ 'ants' ]),
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
    
        return <Synonyms> {
            type: 'success',
            word: word,
            definitions: definitionSet
        };
    }
    catch (e) {
        return <SynonymError> {
            type: 'error',
            message: "Could not connect to dictionary API.  Please check your internet connection."
        };
    }
}