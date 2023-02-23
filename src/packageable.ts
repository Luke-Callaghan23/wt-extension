import { ImportFileSystemView } from "./panels/treeViews/import/importFileSystemView";
import { OutlineView } from "./panels/treeViews/outline/outlineView";
import { TODOsView } from "./panels/treeViews/TODO/TODOsView";
import { WordWatcher } from "./panels/treeViews/wordWatcher/wordWatcher";
import { SynonymViewProvider } from "./panels/webviews/synonymsView";

export interface Packageable {
    getPackageItems (): { [index: string]: any };
}

export async function packageForExport (
    outline: OutlineView,
    todo: TODOsView,
    importFS: ImportFileSystemView,
    synonyms: SynonymViewProvider,
    wordWatcher: WordWatcher,
): Promise<{ [index: string]: any }> {
    const outlinePackageable = outline.getPackageItems();
    const todoPackageable = todo.getPackageItems();
    const synonymsPackageable = synonyms.getPackageItems();
    const wordWatcherPackageable = wordWatcher.getPackageItems();
    return {
        ...outlinePackageable,
        ...todoPackageable,
        ...synonymsPackageable,
        ...wordWatcherPackageable
    };
}