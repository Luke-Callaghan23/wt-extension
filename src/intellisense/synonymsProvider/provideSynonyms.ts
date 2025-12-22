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

    private static readonly cacheLocationConfigName = 'wt.synonyms.cacheLocation';
    private static readonly apiKeyConfigName = 'wt.synonyms.apiKey';
    private static db: Level<[string, SynonymProviderType], SynonymSearchResult> | null;
    private static outgoingQueryCache: Record<SynonymProviderType, Record<string, Promise<SynonymSearchResult>>> = {
        synonymsApi: {},
        wh: {},
    };
    
    private static apiKey: string | null;
    private static cacheLocation: vscode.Uri | null;
    static async init (workspace: Workspace) {
        const cacheUri = await this.processConfigPath();
        await this.openDB(cacheUri);

        const configuration = vscode.workspace.getConfiguration();
        const apiKey = configuration.get<string>(this.apiKeyConfigName);
        this.apiKey = apiKey || null;
        if (apiKey) {
            this.synonymsApi = new QuerySynonyms(apiKey);
        }
        this.registerCommands();
    }

    
    private static async processConfigPath () {
        
        const configuration = vscode.workspace.getConfiguration();
        const synonymsCacheLocation = configuration.get<string>(this.cacheLocationConfigName);

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
        this.cacheLocation = cacheUri;
        return cacheUri;
    }

    private static registerCommands () {
        vscode.commands.registerCommand("wt.synonyms.updateApiKey", async () => {
            const curKey = this.apiKey || "";

            const response = await vscode.window.showInputBox({
                ignoreFocusOut: false,
                placeHolder: "00000000-0000-0000-0000-000000000000",
                prompt: "Enter API Key",
                title: "Enter Merriam-Webster API Key.  This will be stored in your VSCode User Settings.  (No where else).",
                value: curKey,
                valueSelection: [ 0, curKey.length ]
            });
            if (!response) {
                vscode.window.showWarningMessage("[WARN] No API Key provided.  Nothing will be updated.");
                return;
            }

            const apiKey: string = response;

            // Store the key in global setting, then reset the synonyms API here as well as in the SynonymsView
            const config = vscode.workspace.getConfiguration();
            await config.update(this.apiKeyConfigName, apiKey, vscode.ConfigurationTarget.Global);
            this.synonymsApi = new QuerySynonyms(apiKey);
            return vscode.commands.executeCommand("wt.synonyms.refreshWithKey", apiKey);
        });

        vscode.commands.registerCommand("wt.synonyms.updateCachePath", async () => {
            
            const response = await vscode.window.showOpenDialog({
                title: "Enter location to use for synonyms cache.",
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri: this.cacheLocation || undefined,
            });
            if (!response) {
                vscode.window.showWarningMessage("[WARN] Cache location selected.  Nothing will be updated.");
                return;
            }

            const [ updatedLocation ] = response;
            this.cacheLocation = updatedLocation;

            // Store the key in global setting, then reset the synonyms API here as well as in the SynonymsView
            const config = vscode.workspace.getConfiguration();
            await config.update(this.cacheLocationConfigName, updatedLocation.fsPath, vscode.ConfigurationTarget.Workspace);
            
            await this.closeCacheDb();
            await this.openDB(updatedLocation);
        });

    }


    private static async openDB (cacheUri: vscode.Uri) {
        try {
            console.log(`Opening cache uri at ${cacheUri.fsPath}`)
            this.db = new Level<[string, SynonymProviderType], SynonymSearchResult>(cacheUri.fsPath, {
                keyEncoding: 'json',
                valueEncoding: 'json',
                compression: true,
            });
            await this.db.open();
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
                await config.update(this.cacheLocationConfigName, cloned.fsPath, vscode.ConfigurationTarget.Workspace);
                this.cacheLocation = cloned;
                
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
                vscode.window.showInformationMessage(`[INFO] Opened cloned DB at path: '${cloned.fsPath}'`);
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