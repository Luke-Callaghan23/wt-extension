import * as vscode from 'vscode';
import * as vscodeUri from 'vscode-uri';
import { getOrdinal } from '../miscTools/help';
import { MultiSplit, NoSplit, SingleSplit, SnipInfo } from './importFiles';

// Keeping these in a separate document to keep `importFiles.ts` cleaner


export const multiSplitChapterDescription = (dateString: string, docSplits: SingleSplit, idx: number) => {
    return `
${getOrdinal(idx+1)} chapter imported from multi-split of \`${vscodeUri.Utils.basename(docSplits.source)}\` on ${dateString}

---

Source document: \`(${docSplits.source.fsPath})\`

---

Imported ${docSplits.data.length} fragments: 

- ${docSplits.data.map(({ title }, index) => title && title.length !== 0 ? title : `Imported Fragment (${index})`).join("\n\n- ")}
`;
}

export const singleSplitChapterDescription = (dateString: string, docSplits: SingleSplit) => {
    return `
Chapter imported from \`${vscodeUri.Utils.basename(docSplits.source)}\` on ${dateString}

---

Source document: \`(${docSplits.source.fsPath})\`

---

Imported ${docSplits.data.length} fragments: 

- ${docSplits.data.map(({ title }, index) => title && title.length !== 0 ? title : `Imported Fragment (${index})`).join("\n\n- ")}

`;
}

export const noSplitChapterDescription = (dateString: string, docSplits: NoSplit) => {
    return `Chapter imported from \`${vscodeUri.Utils.basename(docSplits.source)}\` on ${dateString}

---

Source document: \`(${docSplits.source.fsPath})\`

---

Imported 1 fragment:

- Imported Fragment (0)

`;
}



export const multiSplitSnipContainerDescription = (dateString: string, docSplits: MultiSplit, snipInfo: SnipInfo) => {
    return `
Snip container for multi-split import of \`${vscodeUri.Utils.basename(docSplits.source)}\` on ${dateString}

---

Source document: \`(${docSplits.source.fsPath})\`

---

Imported ${docSplits.data.length} snips: 

- ${docSplits.data.map(({ title }, index) => title && title.length !== 0 ? title : `${snipInfo.outputSnipName} (${index})`).join("\n\n- ")}
`;
}


export const mutliSplitSnipDescription = (dateString: string, docSplits: MultiSplit, idx: number) => {
    return `
${getOrdinal(idx+1)} snip imported from multi-split of \`${vscodeUri.Utils.basename(docSplits.source)}\` on ${dateString}

---

Source document: \`(${docSplits.source.fsPath})\`

---

Imported ${docSplits.data.length} fragments: 

- ${docSplits.data.map(({ title }, index) => title && title.length !== 0 ? title : `Imported Fragment (${index})`).join("\n\n- ")}
`;
}


export const singleSplitSnipDescription = (dateString: string, docSplits: SingleSplit) => {
    return `
Snip imported from \`${vscodeUri.Utils.basename(docSplits.source)}\` on ${dateString}

---

Source document: \`(${docSplits.source.fsPath})\`

---

Imported ${docSplits.data.length} fragments: 

- ${docSplits.data.map(({ title }, index) => title && title.length !== 0 ? title : `Imported Fragment (${index})`).join("\n\n- ")}
`;
}

export const noSplitSnipDescription = (dateString: string, docSplits: NoSplit) => {
    return `
Snip imported from \`${vscodeUri.Utils.basename(docSplits.source)}\` on ${dateString}

---

Source document: \`(${docSplits.source.fsPath})\`

---

Imported 1 fragment:

- Imported Fragment (0)
`;
};
