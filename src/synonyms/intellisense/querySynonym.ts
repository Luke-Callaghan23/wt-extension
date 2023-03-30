type Definition = {
    definitions :  string[],
    part        :  string,
    synonyms    :  string[],
    antonyms    :  string[],
};

type Synonyms = {
    word: string,
    definitions: Definition[]
};


async function query (word: string): Promise<Synonyms | null> {
    word = word.toLowerCase();
    // @ts-ignore
    const api = `https://dictionaryapi.com/api/v3/references/thesaurus/json/${word}?key=${dicationatyApi}`;
    const resp = await fetch(api);
    const json = await resp.json();

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

    if (typeof json[0] === 'string') {
        return null;
    }

    const definitions: Definition[] = json.map((definition: any) => {
        if (definition.hwi.hw === word) return {
            'definitions' :  parseList(definition[ 'shortdef' ]),
            'part'        :  definition[ 'fl' ],
            'synonyms'    :  parseList(definition[ 'meta' ][ 'syns' ]),
            'antonyms'    :  parseList(definition[ 'meta' ][ 'ants' ]),
        }
        else return [];
    }).flat();

    return {
        word: word,
        definitions
    };
}