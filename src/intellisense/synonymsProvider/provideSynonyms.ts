import * as vscode from 'vscode';
import { QuerySynonyms } from "./synonymsApi";
import * as extension from './../../extension';
import { Workspace } from '../../workspace/workspaceClass';
import * as console from '../../miscTools/vsconsole';
import * as fs from 'fs';
import { Level } from 'level';
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

    static db: Level<[string, SynonymProviderType], SynonymSearchResult> | null;
    private static outgoingQueryCache: Record<SynonymProviderType, Record<string, Promise<SynonymSearchResult>>> = {
        synonymsApi: {},
        wh: {},
    };
    
    static async init (workspace: Workspace) {
        const cacheUri = await this.processConfigPath();

        try {
            await this.openDB(cacheUri);
        }
        catch (err: any) {
            if ("cause" in err && "code" in err.cause && err.cause.code === 'LEVEL_LOCKED') {

                let cloned: vscode.Uri;
                let checkIdx = 1;
                do  {
                    cloned = vscode.Uri.file(cacheUri.fsPath + ` (${checkIdx})`);
                    checkIdx++;
                }
                while ((await statFile(cloned)) !== null);

                const response = await vscode.window.showInformationMessage(
                    `[WARN] Synonyms cache at '${cacheUri.fsPath}' already opened by another process`,
                    {
                        detail: `Would you like to clone that cache and use the copy instead?  Cloned location: '${cloned.fsPath}'`,
                        modal: true,
                    },
                    "Yes, clone",
                    "No, do not use a cache"
                );
                if (response !== 'Yes, clone') {
                    vscode.window.showWarningMessage("[WARN] Cache already in use.  No cache will be used.");
                    return;
                }

                // Set the new cache location, just for this workspace
                const config = vscode.workspace.getConfiguration();
                await config.update(this.cacheConfigName, cloned.fsPath, vscode.ConfigurationTarget.Workspace);
                
                await vscode.workspace.fs.createDirectory(cloned);

                // Clone all the files in the cacheUri into new folder `cloned`
                const dbItems = await vscode.workspace.fs.readDirectory(cacheUri);
                await Promise.all(dbItems.map(([ fileName, type ]) => {
                    // 'LOCK' file is locked by the other level db process.  Cannot be cloned.
                    // BUT, we can clone everything else :)
                    if (fileName === 'LOCK') {
                        // NOTE: it seems like level DB will create this file on its own if it does not exist in a DB,
                        //      so neglecting to create it now is fine
                        return [];
                    }
                    else {
                        // Otherwise, just copy the file as is into the new directory
                        return vscode.workspace.fs.copy(
                            vscode.Uri.joinPath(cacheUri, fileName),
                            vscode.Uri.joinPath(cloned, fileName),
                        )
                    }
                }).flat());

                // Open the cloned cache db
                await this.openDB(cloned);
            }
            else {
                const response = await vscode.window.showInformationMessage(
                    `[ERR] An error occurred while opening synonyms cache DB at '${cacheUri.fsPath}'`, 
                    {
                        detail: `Message from LevelDB: '${err?.cause?.message}'.  JSON error: ${JSON.stringify(err)}.  Please resolve this or disable the synonyms cache.`,
                        modal: true
                    },
                    "Continue, do not use cache"
                );
                if (response !== 'Continue, do not use cache') {
                    vscode.window.showErrorMessage("[ERR] Please enter a valid snyonyms cache folder into 'wt.synonyms.cacheLocation' before continuing.");
                    throw err;
                }
            }
        }

        const configuration = vscode.workspace.getConfiguration();
        const apiKey = configuration.get<string>('wt.synonyms.apiKey');
        if (!apiKey) {
            vscode.window.showWarningMessage(`WARN: The synonyms view uses a dictionary API for intellisense to function.  You need to get your own API key from 'https://dictionaryapi.com/register/index', update the wt.synonyms.apiKey setting, then reload your window.`);
        }
        else {
            this.synonymsApi = new QuerySynonyms(apiKey);
        }
    }

    
    static cacheConfigName = 'wt.synonyms.cacheLocation';
    private static async processConfigPath () {
        
        const configuration = vscode.workspace.getConfiguration();
        const synonymsCacheLocation = configuration.get<string>(this.cacheConfigName);

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


    private static async openDB (cacheUri: vscode.Uri) {
        console.log(`Opening cache uri at ${cacheUri.fsPath}`)
        this.db = new Level<[string, SynonymProviderType], SynonymSearchResult>(cacheUri.fsPath, {
            keyEncoding: 'json',
            valueEncoding: 'json',
            compression: true,
        });
        await this.db.open();
    }

    static async getCachedSynonym (word: string, provider: 'wh' | 'synonymsApi'): Promise<SynonymSearchResult | null> {
        return new Promise(async (resolve, reject) => {
            word = word.toLocaleLowerCase().trim();
            const result: SynonymSearchResult | undefined = await this.db?.get([ word, provider ]);
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
        return this.db?.close();
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
                    this.db?.put([ word, provider ], result);
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