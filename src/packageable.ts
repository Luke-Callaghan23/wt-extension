import * as vscode from 'vscode';
import { DiskContextType } from './workspace/workspaceClass';

type RequiredPick<T, K extends keyof T> = {
    [P in K]-?: T[P];
};

export function createPackageItems<T extends keyof DiskContextType>(
    items: Pick<DiskContextType, T>
): Pick<DiskContextType, T> {
    return items;
}

export type Packager<T extends keyof DiskContextType> = (items: Pick<DiskContextType, T>) => Pick<DiskContextType, T>;

export interface Packageable<T extends keyof DiskContextType> {
    getPackageItems (packager: Packager<T>): Pick<DiskContextType, T>;
}

export async function packageForExport (
    packageables: Packageable<any>[]
): Promise<{ [index: string]: any }> {
    const allPackagedItems: { [index: string]: any } = {};
    packageables.forEach(packageable => {
        const items = packageable.getPackageItems(createPackageItems);
        Object.entries(items).forEach(([ contextKey, contextValue ]) => {
            allPackagedItems[contextKey] = contextValue;
        });
    });
    return allPackagedItems;
}

