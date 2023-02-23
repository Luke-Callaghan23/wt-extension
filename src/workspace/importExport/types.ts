import { Config } from "../workspace";

export type WorkspaceExport = {
    config: Config,
    chapters: ChaptersRecord,
    snips: SnipsRecord,
    packageableItems: { [index: string]: any }
};

// Ordered array of chapters data
export type ChaptersRecord = {
    title: string,
    fragments: FragmentRecord,
    snips: SnipsRecord
}[];

// Ordered array of snip data
export type SnipsRecord = {
    title: string,
    fragments: FragmentRecord,
}[];

// Ordered array of fragments markdown strings in that container
export type FragmentRecord = {
    title: string,
    markdown: string
}[];