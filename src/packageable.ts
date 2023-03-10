import { ImportFileSystemView } from "./import/importFileSystemView";
import { OutlineView } from "./outline/outlineView";
import { TODOsView } from "./TODO/TODOsView";
import { WordWatcher } from "./wordWatcher/wordWatcher";
import { SynonymViewProvider } from "./synonyms/synonymsView";

export interface Packageable {
    getPackageItems (): { [index: string]: any };
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
    return allPackagedItems
}