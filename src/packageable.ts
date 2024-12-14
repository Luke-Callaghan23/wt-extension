import * as vscode from 'vscode';
import { DiskContextType } from "./workspace/workspace";

export interface Packageable {
    getPackageItems (): Partial<DiskContextType>;
}

export async function packageForExport (
    packageables: Packageable[]
): Promise<{ [index: string]: any }> {
    const allPackagedItems: { [index: string]: any } = {};
    packageables.forEach(packageable => {
        const items = packageable.getPackageItems();
        Object.entries(items).forEach(([ contextKey, contextValue ]) => {
            allPackagedItems[contextKey] = contextValue;
        });
    });
    return allPackagedItems;
}