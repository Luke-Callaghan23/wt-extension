import * as vscode from 'vscode';
import Datastore = require('nedb');
import { Synonyms } from './provideSynonyms';
import * as extension from './../../extension';

export class SynonymsDB {
    db: Datastore<Synonyms> | null;
    constructor () {
        this.db = null;
    }
    
    async initSynonymsDb (): Promise<void> {
        const db = new Datastore<Synonyms>({
            filename: `${extension.rootPath.fsPath}/data/synonyms_db.db`,
            autoload: true, 
        });
        db.ensureIndex({ fieldName: "word", });
        db.ensureIndex({ fieldName: "provider" });
    
        await new Promise<void>((resolve, reject) => {
            db.loadDatabase((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
        this.db = db;
    }

    async insertSynonym (syn: Synonyms): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject();
                return;
            }
            this.db.insert(syn, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }

    async getSynonym (word: string, provider: 'wh' | 'synonymsApi'): Promise<Synonyms> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject();
                return;
            };
            this.db.findOne({ provider: provider, word: { $regex: new RegExp(word, "i") } }, (err, document) => {
                if (err) {
                    reject();
                    return;
                }
                console.log(document);
                if (
                    document !== undefined && 
                    document !== null && 
                    typeof document === 'object' &&
                    'type' in document &&
                    document.type === 'success'
                ) {
                    console.log(`Hit in DB for word '${word}' with provider '${provider}'`);
                    resolve(document);
                }
                else {
                    reject();
                }
            });
        });
    }
}
