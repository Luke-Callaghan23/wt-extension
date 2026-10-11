import { SerializedNote } from "../../notebook/notebookApi/notebookSerializer";
import { Config } from "../workspace";

export type WorkspaceExport = {
    config: Config,
    chapters?: (ChaptersExport[]) | ChaptersGroupExport,
    chapterGroups?: ChaptersGroupExport[],
    snips: SnipsExport[],
    scratchPad: FragmentsExport[]
    notebook: SerializedNote[],
    packageableItems: { [index: string]: any }
};

// Ordered array of chapters data
export type ChaptersExport = {
    title: string,
    description?: string,
    fragments: FragmentsExport[],
    snips: SnipsExport[]
};

export type ChaptersGroupExport = {
    groupName: string,
    chapters: ChaptersExport[],
}

// Ordered array of snip data
export type SnipsExport = {
    title: string,
    description?: string,
    contents: (FragmentsExport | SnipsExport)[],
};

// Ordered array of fragments markdown strings in that container
export type FragmentsExport = {
    title: string,
    description?: string,
    markdown: string
};