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
    labelHighlights: [number, number][];
    description?: string;
    descriptionHighlights: [number, number][];
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

            // For containers and files, the label needs to be prfixed by a count of the results in that container
            //      as well as the original prefix (fragment or snip or container, or whatever), which was created
            //      when this node was originally created

            // For full prefix, first add results count
            let fullPrefix: string = '';
            if (this.node.kind === 'searchContainer') {
                fullPrefix += `(${this.node.results}) `;
            }
            else if (this.node.kind === 'file') {
                fullPrefix += `(${this.node.locations.length}) `;
            }

            // Then the actual prefix
            if (this.node.prefix.length > 0) {
                fullPrefix += `(${this.node.prefix}) `
            }

            // If this is a matched title or a node with a paired matched title, then store the indeces to highlight
            //      for below
            const highlightIndeces = this.node.kind === 'matchedMetadata' 
                ? this.node.labelHighlights
                : this.node.pairedMatchedMetadataNode?.node.labelHighlights;

            if (highlightIndeces) {
                // Map the highlights by movinf all of them over by the length of the prefix
                // (Highlights are originally calculated without a prefix in mind, so we need to adjust all highlights
                //      to account for prefixes, once the prefixes are calculated)
                const remappedHighlights = highlightIndeces.map(([ start, end ]) => {
                    return [ start + fullPrefix.length, end + fullPrefix.length ];
                });
                return <vscode.TreeItemLabel> {
                    label: `${fullPrefix}${this.node.title}`,
                    highlights: remappedHighlights
                }
            }

            // If no highlights, then just return the prefix followed immediately by the title of the node
            return `${fullPrefix}${this.node.title}`;
        }
        throw 'Not accessible';
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
            if (this.node.kind !== 'file' && this.node.kind !== 'searchContainer') return treeStructure;
            if (!this.node.description) return treeStructure;

            treeStructure = treeStructure.replace("\n", "\n\n");
            const preDescription = `${treeStructure}\n\n---\n\n`;
            const withDescription = preDescription + `${this.node.description}`;

            // If there is no paired metadata, we can just return early with just tree + description.  No highlights to apply.
            if (!this.node.pairedMatchedMetadataNode) return new vscode.MarkdownString(withDescription);

            // Same if there is no highlights specifically for the description
            const descriptionHighlights = (this.node.pairedMatchedMetadataNode.node as MatchedMetadataNode).descriptionHighlights;
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
