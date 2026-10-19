// LevelDB-backed synonym cache (desktop). `synonymCache.web.ts` replaces this in the web bundle.
import * as vscode from 'vscode';
import { Level } from 'level';
import * as console from '../../miscTools/vsconsole';
import { statFile } from '../../miscTools/help';
import type { SynonymProviderType, SynonymSearchResult } from './provideSynonyms';
import { OpenedSynonymCache } from './synonymCacheTypes';

export async function openSynonymCache (cacheUri: vscode.Uri, cacheLocationConfigName: string): Promise<OpenedSynonymCache> {
    try {
        console.log(`Opening cache uri at ${cacheUri.fsPath}`)
        const db = new Level<[string, SynonymProviderType], SynonymSearchResult>(cacheUri.fsPath, {
            keyEncoding: 'json',
            valueEncoding: 'json',
            compression: true,
        });
        await db.open();

        vscode.window.showInformationMessage(`Successfully opened synonyms cache at '${cacheUri.fsPath}'`);
        return {
            location: cacheUri,
            cache: {
                get: (word, provider) => db.get([ word, provider ]),
                put: (word, provider, result) => db.put([ word, provider ], result),
                close: () => db.close(),
            },
        };
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
                return { cache: null, location: cacheUri };
            }

            // Set the new cache location, just for this workspace
            const config = vscode.workspace.getConfiguration();
            await config.update(cacheLocationConfigName, cloned.fsPath, vscode.ConfigurationTarget.Workspace);
            
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
            const opened = await openSynonymCache(cloned, cacheLocationConfigName);
            vscode.window.showInformationMessage(`[INFO] Opened cloned DB at path: '${cloned.fsPath}'`);
            return opened;
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
            return { cache: null, location: cacheUri };
        }
    }
}
