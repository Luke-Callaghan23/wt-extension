import * as vscode from 'vscode';
import { SynonymsApi } from "./synonymsApi";
import * as extension from './../../extension';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from './../../vsconsole';

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

type CacheType = { 
    'wh': { [index: string]: SynonymSearchResult },
    'synonymsApi': { [index: string]: SynonymSearchResult },
};
export class SynonymsProvider {
    private static cache: CacheType;
    private static synonymsApi: SynonymsApi;

    private static cacheWasUpdated: boolean = true;
    static async init (workspace: Workspace) {
        this.cache = {
            'wh': {},
            'synonymsApi': {},
        };
        this.synonymsApi = new SynonymsApi();
        this.loadCacheFromDisk(workspace).then(() => {
            const interval = setInterval(() => {
                if (this.cacheWasUpdated) {
                    this.writeCacheToDisk().then(() => {
                        this.cacheWasUpdated = false;
                    });
                }
            }, 2 * 60 * 1000);
        });
    }

    private static async loadCacheFromDisk (workspace: Workspace) {
        try {
            // Read cache from disk
            const cachePath = workspace.synonymsCachePath;
            const buff = await vscode.workspace.fs.readFile(cachePath);
            const cacheJSON = extension.decoder.decode(buff);
            const cacheObj = JSON.parse(cacheJSON);
            
            // Confirm the cache is correctly formatted
            const newCache: CacheType = {
                'synonymsApi': {},
                'wh': {}
            };

            const confirmSynonym = (provider: string, word: string, source: any): SynonymSearchResult => {
                const confirmDefinition = (def: Definition) => {
                    if (def.part === null || def.part === undefined) {
                        throw `Synonym '${word}' for provider '${provider}' definition has no \`part\` field`;
                    }
                    if (typeof def.part !== 'string') {
                        throw `Synonym '${word}' for provider '${provider}' definition has invalid type for \`part\` '${typeof def.part}'`;
                    }

                    if (def.definitions === null || def.definitions === undefined) {
                        throw `Synonym '${word}' for provider '${provider}' definition has no \`definitions\` field`;
                    }
                    if (!Array.isArray(def.definitions)) {
                        throw `Synonym '${word}' for provider '${provider}' definition has invalid type for \`definitions\` '${typeof source.definitions}'`
                    }

                    for (const d of def.definitions) {
                        if (d === null || d === undefined) {
                            throw `Synonym '${word}' for provider '${provider}' definition ${d} is null`;
                        }
                        if (typeof d !== 'string') {
                            throw `Synonym '${word}' for provider '${provider}' definition ${d} has type '${typeof d}'`;
                        }
                    }

                    for (const d of def.synonyms) {
                        if (d === null || d === undefined) {
                            throw `Synonym '${word}' for provider '${provider}' synonym ${d} is null`;
                        }
                        if (typeof d !== 'string') {
                            throw `Synonym '${word}' for provider '${provider}' synonym ${d} has type '${typeof d}'`;
                        }
                    }

                    for (const d of def.antonyms) {
                        if (d === null || d === undefined) {
                            throw `Synonym '${word}' for provider '${provider}' antonym ${d} is null`;
                        }
                        if (typeof d !== 'string') {
                            throw `Synonym '${word}' for provider '${provider}' antonym ${d} has type '${typeof d}'`;
                        }
                    }
                };

                const confirmSynonym = (source: Synonyms) => {
                    if (source.provider === null || source.provider === undefined) {
                        throw `Synonym '${word}' for provider '${provider}' has no \`provider\` field`;
                    }
                    if (typeof source.provider !== 'string') {
                        throw `Synonym '${word}' for provider '${provider}' has invalid type for \`provider\` '${typeof source.provider}'`;
                    }
                    if (source.provider !== 'wh' && source.provider !== 'synonymsApi') {
                        throw `Synonym '${word}' for provider '${provider}' has invalid \`provider\` '${source.provider}'`;
                    }
                    if (source.word === null || source.word === undefined) {
                        throw `Synonym '${word}' for provider '${word}' has no \`word\` field`;
                    }
                    if (typeof source.word !== 'string') {
                        throw `Synonym '${word}' for provider '${provider}' has invalid type for \`word\` '${typeof source.word}'`
                    }
                    if (source.definitions === null || source.definitions === undefined) {
                        throw `Synonym '${word}' for provider '${provider}' has no \`definitions\` field`;
                    }
                    if (!Array.isArray(source.definitions)) {
                        throw `Synonym '${word}' for provider '${provider}' has invalid type for \`definitions\` '${typeof source.definitions}'`
                    }
                    for (const def of source.definitions) {
                        confirmDefinition(def);
                    }
                }

                const confirmSynonymError = (source: SynonymError) => {
                    if (source.message === null || source.message === undefined) {
                        throw `Synonym '${word}' for provider '${provider}' has no \`message\` field`;
                    }
                }

                let s: Synonyms | SynonymError = source;
                if ('type' in s) {
                    if (s.type === 'error') {
                        confirmSynonymError(s);
                    }
                    else if (s.type === 'success') {
                        confirmSynonym(s)
                    }
                    else {
                        //@ts-ignore
                        throw `Synonym '${word}' for provider '${provider}' has invalid \`type\` '${s.type}'`;
                    }
                }
                else {
                    throw `Synonym '${word}' for provider '${provider}' has no \`type\``;
                }
                return s;
            }

            const confirmSource = (provider: string, source: { [index: string]: any }): { [index: string]: SynonymSearchResult } => {
                const dest: { [index: string]: SynonymSearchResult } = {};
                for (const word of Object.keys(source)) {
                    const potentialSyn = source[word];
                    const syn = confirmSynonym(provider, word, potentialSyn);
                    dest[word] = syn;
                }
                return dest;
            };

            if ('wh' in cacheObj) {
                const whSource = confirmSource('wh', cacheObj['wh']);
                newCache.wh = whSource;
            }
            else {
                throw `Provider 'wh' was missing from cache`;
            }

            if ('synonymsApi' in cacheObj) {
                const apiSource = confirmSource('synonymsApi', cacheObj['synonymsApi']);
                newCache.synonymsApi = apiSource;
            }
            else {
                throw `Provider 'synonymsApi' was missing from cache`;
            }

            vscode.window.showInformationMessage('[INFO] Successfully loaded synonyms cache from disk!');
            this.cache = newCache;
        }
        catch (err: any) {
            vscode.window.showWarningMessage(`[WARN] Could not load synonyms cache because: '${err}'`)
        } 
    }

    public static async writeCacheToDisk (useDefaultFS: boolean = false) {
        try {
            const cachePath = extension.ExtensionGlobals.workspace.synonymsCachePath;
            const cacheBuffer = extension.encoder.encode(JSON.stringify(this.cache));
            
            await vscode.workspace.fs.writeFile(cachePath, cacheBuffer);
            console.log("Saving cache to disk");
        }
        catch (err: any) {
            vscode.window.showInformationMessage(`[WARN] Could not save synonyms cache because: '${err}'`);
        }
    }

    static async getCachedSynonym (word: string, provider: 'wh' | 'synonymsApi'): Promise<SynonymSearchResult | null> {
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
            else return resolve(null);
        });
    }

    static async provideSynonyms (word: string, provider: 'wh' | 'synonymsApi'): Promise<SynonymSearchResult> {
        if (!word) return {
            type: "error",
            message: "Blank word",
        };
        try {
            let result: SynonymSearchResult;

            const cacheResult: SynonymSearchResult | null = await SynonymsProvider.getCachedSynonym(word, provider);
            if (!cacheResult) {
                result = await SynonymsProvider.synonymsApi.getSynonym(word, provider);
            }
            else {
                result = cacheResult;
            }

            if (result !== undefined && 
                result !== null && 
                typeof result === 'object' &&
                'type' in result &&
                result.type === 'success'
            ) {
                console.log(this.cache);
                this.cache[provider][word.toLocaleLowerCase().trim()] = result;
                this.cacheWasUpdated = true;
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