import { SerializedNote } from "../../notebook/notebookApi/notebookSerializer";
import { Config } from "../workspace";

export type WorkspaceExport = {
    config: Config,
    chapters?: (ChaptersRecord[]) | ChaptersGroupRecord,
    chapterGroups?: ChaptersGroupRecord[],
    snips: SnipsRecord,
    scratchPad: FragmentRecord
    notebook: SerializedNote[],
    packageableItems: { [index: string]: any }
};

// Ordered array of chapters data
export type ChaptersRecord = {
    title: string,
    description?: string,
    fragments: FragmentRecord,
    snips: SnipsRecord
};

export type ChaptersGroupRecord = {
    groupName: string,
    chapters: ChaptersRecord[],
}

// Ordered array of snip data
export type SnipsExport = {
    title: string,
    description?: string,
    contents: (FragmentsExport | SnipsExport)[],
};

export type SnipsRecord = SnipsExport[];

// Ordered array of fragments markdown strings in that container
export type FragmentsExport = {
    title: string,
    description?: string,
    markdown: string
};
export type FragmentRecord = FragmentsExport[];