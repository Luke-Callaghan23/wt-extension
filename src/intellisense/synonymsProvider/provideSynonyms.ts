import * as vscode from 'vscode';
import { QuerySynonyms } from "./synonymsApi";
import * as extension from './../../extension';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../miscTools/vsconsole';
import * as fs from 'fs';
import { open } from 'lmdb';
import lmdb = require('lmdb');
import { statFile } from '../../miscTools/help';
export type SynonymProviderType = 'wh' | 'synonymsApi';

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
    private static synonymsApi: QuerySynonyms;

    static db: lmdb.RootDatabase<SynonymSearchResult, [string, SynonymProviderType]>;
    private static outgoingQueryCache: Record<SynonymProviderType, Record<string, Promise<SynonymSearchResult>>> = {
        synonymsApi: {},
        wh: {},
    };
    
    private static currentCacheUri: vscode.Uri;
    static async init (workspace: Workspace) {

        
        const cacheUri = await this.processConfigPath();
        this.openDB(cacheUri);
        this.currentCacheUri = cacheUri;

        vscode.workspace.onDidChangeConfiguration(async (ev) => {
            if (!ev.affectsConfiguration('wt.synonyms.cacheLocation')) return;

            const cacheUri = await this.processConfigPath();
            if (cacheUri.fsPath === this.currentCacheUri.fsPath) {
                vscode.window.showWarningMessage('[WARN] Cache location the same as before configuration edit. Not re-opening db.');
            }
            else {
                await this.db.close();
            }
            this.openDB(cacheUri);
            this.currentCacheUri = cacheUri;
        })

        this.synonymsApi = new QuerySynonyms();
    }

    
    private static async processConfigPath () {
        
        const configuration = vscode.workspace.getConfiguration();
        const synonymsCacheLocation = configuration.get<string>('wt.synonyms.cacheLocation');

        let cacheUri: vscode.Uri;
        if (!synonymsCacheLocation) {
            vscode.window.showWarningMessage('[WARN] Configuration for Synonyms Cache Location is missing. Using default ./synonyms instead');
            cacheUri = vscode.Uri.joinPath(extension.rootPath, 'synonyms');
        }
        else {
            if (synonymsCacheLocation.startsWith('/') || synonymsCacheLocation.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(synonymsCacheLocation)) {
                cacheUri = vscode.Uri.file(synonymsCacheLocation);
            }
            else {
                cacheUri = vscode.Uri.joinPath(extension.rootPath, synonymsCacheLocation);
            }

            const stat = await statFile(cacheUri);
            if (stat === null) {
                vscode.window.showWarningMessage(`[WARN] Could not open Synonyms Cache at ${synonymsCacheLocation}.  Using default ./synonyms instead.`);
                cacheUri = vscode.Uri.joinPath(extension.rootPath, 'synonyms');
            }
        }
        return cacheUri;
    }


    private static openDB (cacheUri: vscode.Uri) {
        console.log(`Opening cache uri at ${cacheUri.fsPath}`)
        this.db = open(cacheUri.fsPath, {
            compression: true,
        })
        
        console.log('Counting cache contents: ');
        let wh = 0;
        let synonymsApi = 0;
        for (const key of this.db.getKeys()) {
            const [ word, provider ] = key as [ string, SynonymProviderType ];
            if (provider === 'wh') {
                wh++;
            }
            else {
                synonymsApi++;
            }
        }
        console.log(`WH cache count: ${wh}, Synonyms API cache count: ${synonymsApi}`);
    }

    static async getCachedSynonym (word: string, provider: 'wh' | 'synonymsApi'): Promise<SynonymSearchResult | null> {
        return new Promise((resolve, reject) => {
            word = word.toLocaleLowerCase().trim();
            const result: SynonymSearchResult | undefined = this.db.get([ word, provider ]);
            if (result !== undefined && 
                result !== null && 
                typeof result === 'object' &&
                'type' in result &&
                result.type === 'success'
            ) {
                console.log(`Hit in cache for word '${word}' with provider '${provider}'`);
                resolve(result);
                return;
            }
            else return resolve(null);
        });
    }

    static async closeCacheDb () {
        await this.db.committed;
        this.db.close();
    }

    static async provideSynonyms (word: string, provider: 'wh' | 'synonymsApi'): Promise<SynonymSearchResult> {
        if (!word) return {
            type: "error",
            message: "Blank word",
        };
        try {
            let result: SynonymSearchResult;
            let notInCache = true;
            const cacheResult: SynonymSearchResult | null = await SynonymsProvider.getCachedSynonym(word, provider);

            if (!cacheResult) {
                notInCache = true;

                const queryCacheResult: Promise<SynonymSearchResult> | undefined = this.outgoingQueryCache[provider][word];
                if (queryCacheResult) {
                    console.log(`Synonym provider outgoing query cache hit for provider=${provider} and word=${word}`);
                    result = await queryCacheResult;
                }
                else {
                    const resultPromise = SynonymsProvider.synonymsApi.getSynonym(word, provider);
                    this.outgoingQueryCache[provider][word] = resultPromise;
                    result = await resultPromise;
                }
            }
            else {
                notInCache = false;
                result = cacheResult;
            }

            if (notInCache) {
                if (result['type'] === 'success' && result['provider'] === provider) {
                    this.db.put([ word, provider ], result);
                }
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