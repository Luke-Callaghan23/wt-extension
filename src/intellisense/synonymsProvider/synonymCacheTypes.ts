import type * as vscode from 'vscode';
import type { SynonymProviderType, SynonymSearchResult } from './provideSynonyms';

export interface SynonymCache {
    get (word: string, provider: SynonymProviderType): Promise<SynonymSearchResult | undefined>;
    put (word: string, provider: SynonymProviderType, result: SynonymSearchResult): Promise<void>;
    close (): Promise<void>;
}

export type OpenedSynonymCache = {
    cache: SynonymCache | null,
    location: vscode.Uri,
};
