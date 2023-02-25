import { ImportFileSystemView } from "./panels/treeViews/import/importFileSystemView";
import { OutlineView } from "./panels/treeViews/outline/outlineView";
import { TODOsView } from "./panels/treeViews/timedViews/TODO/TODOsView";
import { WordWatcher } from "./panels/treeViews/timedViews/wordWatcher/wordWatcher";
import { SynonymViewProvider } from "./panels/webviews/synonymsView";

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