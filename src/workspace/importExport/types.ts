import { SerializedNote } from "../../notebook/notebookApi/notebookSerializer";
import { Config } from "../workspace";

export type WorkspaceExport = {
    config: Config,
    chapters: ChaptersRecord,
    snips: SnipsRecord,
    scratchPad: FragmentRecord
    notebook: SerializedNote[],
    packageableItems: { [index: string]: any }
};

// Ordered array of chapters data
export type ChaptersRecord = {
    title: string,
    fragments: FragmentRecord,
    snips: SnipsRecord
}[];

// Ordered array of snip data
export type SnipsExport = {
    title: string,
    contents: (FragmentsExport | SnipsExport)[],
};

export type SnipsRecord = SnipsExport[];

// Ordered array of fragments markdown strings in that container
export type FragmentsExport = {
    title: string,
    markdown: string
};
export type FragmentRecord = FragmentsExport[];