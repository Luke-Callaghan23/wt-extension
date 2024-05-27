import { SynonymsApi } from "./synonymsApi";


export type Definition = {
    definitions :  string[],
    part        :  string,
    synonyms    :  string[],
    antonyms    :  string[],
};

export type Synonyms = {
    type: 'success',
    provider: 'wh' | 'synonymsApi',
    word: string,
    definitions: Definition[]
};

export type SynonymError = {
    type: 'error',
    message: string,
    suggestions?: string[]
}

export type SynonymSearchResult = Synonyms | SynonymError;

export class SynonymsProvider {
    private static cache: { 
        'wh': { [index: string]: SynonymSearchResult },
        'synonymsApi': { [index: string]: SynonymSearchResult },
    };
    private static synonymsApi: SynonymsApi;


    static async init () {
        this.cache = {
            'wh': {},
            'synonymsApi': {},
        };
        this.synonymsApi = new SynonymsApi();
    }

    static async getCachedSynonym (word: string, provider: 'wh' | 'synonymsApi'): Promise<SynonymSearchResult> {
        return new Promise((resolve, reject) => {
            word = word.toLocaleLowerCase().trim();
            if (word in this.cache[provider] && 
                this.cache[provider][word] !== undefined && 
                this.cache[provider][word] !== null && 
                typeof this.cache[provider][word] === 'object' &&
                'type' in this.cache[provider][word] &&
                this.cache[provider][word].type === 'success'
            ) {
                console.log(`Hit in cache for word '${word}' with provider '${provider}'`);
                resolve(this.cache[provider][word]);
                return;
            }
            reject();
        });
    }

    static async provideSynonyms (word: string, provider: 'wh' | 'synonymsApi'): Promise<SynonymSearchResult> {
        if (!word) return {
            type: "error",
            message: "Blank word",
        };
        try { 
            const result: SynonymSearchResult = await Promise.any([
                SynonymsProvider.getCachedSynonym(word, provider),
                SynonymsProvider.synonymsApi.getSynonym(word, provider),
            ]);

            if (result !== undefined && 
                result !== null && 
                typeof result === 'object' &&
                'type' in result &&
                result.type === 'success'
            ) {
                this.cache[provider][word.toLocaleLowerCase().trim()] = result;
            }

            return result;
        }
        catch (err: any) {
            const result: SynonymSearchResult = {
                type: 'error',
                message: `Could not find '${word}' in any definition provider.`,
                suggestions: [],
            }
            // this.cache[provider][word] = result;
            return result;
        }
    }
}