import * as vscode from 'vscode';
import { HasGetUri } from '../outlineProvider/UriBasedView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { applyHighlightToMarkdownString, applyMultiHighlightToMarkdownString, VagueNodeSearchResult } from '../miscTools/help';
import { start } from 'repl';
import { createLabelFromTitleAndPrefix } from './searchNodeGenerator';

export type FileResultNode = {
    kind: 'file';
    ext: string;
    uri: vscode.Uri;
    parentLabels: string[];
    parentUri: vscode.Uri;
    title: string;
    prefix: string;
    locations: SearchNode<FileResultLocationNode>[];
    description?: string;
    pairedMatchedMetadataNode?: SearchNode<MatchedMetadataNode>;
    ordering: number;
}

export type FileResultLocationNode = {
    kind: 'fileLocation';
    uri: vscode.Uri;
    parentUri: vscode.Uri;
    parentLabels: string[];
    location: vscode.Location;
    surroundingText: string;
    surroundingTextHighlight: [ number, number ];
    largerSurroundingText: string;
    largerSurroundingTextHighlight: [ number, number ];
};

export type SearchContainerNode = {
    kind: 'searchContainer';
    uri: vscode.Uri;
    parentUri: vscode.Uri | null;
    parentLabels: string[];
    title: string;
    prefix: string;
    results: number;
    contents: Record<string, SearchNode<SearchContainerNode | FileResultNode | MatchedMetadataNode>>;
    description?: string;
    pairedMatchedMetadataNode?: SearchNode<MatchedMetadataNode>;
    ordering: number;
};

export type MatchedMetadataNode = {
    kind: 'matchedMetadata',
    uri: vscode.Uri;
    parentUri: vscode.Uri;
    parentLabels: string[];
    title: string;
    prefix: string;
    titleHighlightInfo: [number, number][];
    description?: string;
    descriptionHighlightInfo: [number, number][];
    linkNode: Exclude<VagueNodeSearchResult, { node: null, source: null}>;
    ordering: number;
};

export type SearchNodeTemporaryText = {
    kind: 'searchTemp',
    uri: vscode.Uri;
    parentUri: null;
    label: string;
}

export class SearchNode<T extends FileResultNode | SearchContainerNode | FileResultLocationNode | SearchNodeTemporaryText | MatchedMetadataNode> implements HasGetUri {
    node: T;
    description?: string;
    constructor (node: T) {
        this.node = node;
    }

    getUri (): vscode.Uri {
        return this.node.uri;
    }

    getLocation(): vscode.Uri | vscode.Location {
        if (this.node.kind === 'fileLocation') {
            return this.node.location;
        }
        else return this.node.uri;
    }

    getParentUri (): vscode.Uri | null {
        return this.node.parentUri;
    }
    
    getLabel (): string | vscode.TreeItemLabel {
        if (this.node.kind === 'fileLocation') {
            return <vscode.TreeItemLabel> {
                label: this.node.surroundingText || '<empty>',
                highlights: [this.node.surroundingTextHighlight]
            }
        }
        else if (this.node.kind === 'searchTemp') {
            return this.node.label  || '<empty>';
        }
        else if (this.node.kind === 'file' || this.node.kind === 'searchContainer' || this.node.kind === 'matchedMetadata') {

            // The count and path are shown in the description (see getResultsCount)
            const fullPrefix = this.node.prefix.length > 0 ? `(${this.node.prefix}) ` : '';

            const highlightIndeces = this.node.kind === 'matchedMetadata' 
                ? this.node.titleHighlightInfo
                : this.node.pairedMatchedMetadataNode?.node.titleHighlightInfo;

            if (highlightIndeces) {
                // Highlights are calculated without the prefix, so shift them past it
                return <vscode.TreeItemLabel> {
                    label: `${fullPrefix}${this.node.title}`,
                    highlights: highlightIndeces.map(([ start, end ]) => [ start + fullPrefix.length, end + fullPrefix.length ])
                }
            }

            return `${fullPrefix}${this.node.title}`;
        }
        throw 'Not accessible';
    }

    getResultsCount (): number | undefined {
        if (this.node.kind === 'searchContainer') return this.node.results;
        if (this.node.kind === 'file') return this.node.locations.length;
        return undefined;
    }

    getTooltip (): string | vscode.MarkdownString {
        if (this.node.kind === 'fileLocation') {
            return applyHighlightToMarkdownString(this.node.largerSurroundingText, this.node.largerSurroundingTextHighlight);
        }
        else if (this.node.kind !== 'searchTemp') {

            const styleCharacter = !!this.node.description
                ? '-'
                : '|';

            // Create a tree structure for this node in markdown
            // Displays the parents of this node
            const segments = this.node.parentLabels;
            let description = '';
            for (let indent = 0; indent < segments.length; indent++) {
                description += segments[indent];
                description += ('\n' + Array(indent + 1).fill(`${styleCharacter}   `).join(''))
            }
            let treeStructure = description + createLabelFromTitleAndPrefix(this.node.title, this.node.prefix);

            // If there is no node description to add onto the tooltip, exit with just the constructed tree structure
            if (!this.node.description) return treeStructure;

            treeStructure = treeStructure.replace("\n", "\n\n");
            const preDescription = `${treeStructure}\n\n---\n\n`;
            const withDescription = preDescription + `${this.node.description}`;

            let metadataNode: MatchedMetadataNode | undefined;
            if (this.node.kind === 'file' || this.node.kind === 'searchContainer') {
                metadataNode = this.node.pairedMatchedMetadataNode?.node;
            }
            else {
                metadataNode = this.node;
            }

            if (!metadataNode) return new vscode.MarkdownString(withDescription);


            // Same if there is no highlights specifically for the description
            const descriptionHighlights = metadataNode.descriptionHighlightInfo;
            if (descriptionHighlights.length === 0) return new vscode.MarkdownString(withDescription);

            // Apply highlights to tooltip
            const md = applyMultiHighlightToMarkdownString(this.node.description, descriptionHighlights);

            // Add the pre description to the markdown value
            md.value = preDescription + md.value;
            return md;
        }
        else return this.node.label;
    }
    
    async getChildren (
        filter: boolean, 
        insertIntoNodeMap: (node: HasGetUri, uri: vscode.Uri) => void
    ): Promise<SearchNode<FileResultNode | SearchContainerNode | MatchedMetadataNode | FileResultLocationNode>[]> {
        if (this.node.kind === 'file') {
            return this.node.locations.sort((a, b) => a.node.location.range.start.compareTo(b.node.location.range.start));
        }
        else if (this.node.kind === 'searchContainer') {
            return Object.values(this.node.contents).sort((a, b) => a.node.ordering - b.node.ordering);
        }
        else return [];
    }
}
