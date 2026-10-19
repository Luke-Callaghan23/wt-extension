// Web replacement for `synonymCache.ts`: LevelDB is unavailable, so cache in memory for the session.
import type * as vscode from 'vscode';
import type { SynonymProviderType, SynonymSearchResult } from './provideSynonyms';
import { OpenedSynonymCache } from './synonymCacheTypes';

export async function openSynonymCache (cacheUri: vscode.Uri, cacheLocationConfigName: string): Promise<OpenedSynonymCache> {
    const entries = new Map<string, SynonymSearchResult>();
    const keyOf = (word: string, provider: SynonymProviderType) => JSON.stringify([ word, provider ]);
    return {
        location: cacheUri,
        cache: {
            get: async (word, provider) => entries.get(keyOf(word, provider)),
            put: async (word, provider, result) => { entries.set(keyOf(word, provider), result); },
            close: async () => { entries.clear(); },
        },
    };
}
