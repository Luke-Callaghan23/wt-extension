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