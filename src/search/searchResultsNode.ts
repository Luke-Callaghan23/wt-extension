import * as vscode from 'vscode';
import { HasGetUri } from '../outlineProvider/UriBasedView';
import { OutlineNode } from '../outline/nodes_impl/outlineNode';
import { VagueNodeSearchResult } from '../miscTools/help';
import { start } from 'repl';
import { createLabelFromTitleAndPrefix } from './processGrepResults/createNodeTree';

export type FileResultNode = {
    kind: 'file';
    ext: string;
    uri: vscode.Uri;
    parentLabels: string[];
    parentUri: vscode.Uri;
    title: string;
    prefix: string;
    locations: SearchNode<FileResultLocationNode>[];
    pairedMatchedTitleNode?: SearchNode<MatchedTitleNode>;
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
    contents: SearchNode<SearchContainerNode | FileResultNode | MatchedTitleNode>[];
    pairedMatchedTitleNode?: SearchNode<MatchedTitleNode>;
};


export type MatchedTitleNode = {
    kind: 'matchedTitle',
    uri: vscode.Uri;
    parentUri: vscode.Uri;
    parentLabels: string[];
    title: string;
    prefix: string;
    labelHighlights: [number, number][];
    linkNode: Exclude<VagueNodeSearchResult, { node: null, source: null}>,
}


export type SearchNodeTemporaryText = {
    kind: 'searchTemp',
    uri: vscode.Uri;
    parentUri: null;
    label: string;
}

export class SearchNode<T extends FileResultNode | SearchContainerNode | FileResultLocationNode | SearchNodeTemporaryText | MatchedTitleNode> implements HasGetUri {
    node: T;
    description?: string;
    constructor (node: T) {
        this.node = node;
    }

    getUri (): vscode.Uri {
        return this.node.uri;
    }
    getParentUri (): vscode.Uri | null {
        return this.node.parentUri;
    }
    
    getLabel (): string | vscode.TreeItemLabel {
        if (this.node.kind === 'fileLocation') {
            return <vscode.TreeItemLabel> {
                label: this.node.surroundingText,
                highlights: [this.node.surroundingTextHighlight]
            }
        }
        else if (this.node.kind === 'searchTemp') {
            return this.node.label;
        }
        else if (this.node.kind === 'file' || this.node.kind === 'searchContainer' || this.node.kind === 'matchedTitle') {
            let fullPrefix: string = '';
            if (this.node.kind === 'searchContainer') {
                fullPrefix += `(${this.node.results}) `;
            }
            else if (this.node.kind === 'file') {
                fullPrefix += `(${this.node.locations.length}) `;
            }

            if (this.node.prefix.length > 0) {
                fullPrefix += `(${this.node.prefix}) `
            }

            const highlightIndeces = this.node.kind === 'matchedTitle' 
                ? this.node.labelHighlights
                : this.node.pairedMatchedTitleNode?.node.labelHighlights;

            if (highlightIndeces) {
                const remappedHighlights = highlightIndeces.map(([ start, end ]) => {
                    return [ start + fullPrefix.length, end + fullPrefix.length ];
                });
                return <vscode.TreeItemLabel> {
                    label: `${fullPrefix}${this.node.title}`,
                    highlights: remappedHighlights
                }
            }
            return `${fullPrefix}${this.node.title}`;
        }
        throw 'Not accessible';
    }

    getTooltip (): string | vscode.MarkdownString {
        if (this.node.kind === 'fileLocation') {
            // TDOD: make a visual tree for the
            // Split on the highlights for the larger surrounding text
            const splits = [
                this.node.largerSurroundingText.substring(0, this.node.largerSurroundingTextHighlight[0]),
                this.node.largerSurroundingText.substring(this.node.largerSurroundingTextHighlight[0], this.node.largerSurroundingTextHighlight[1]),
                this.node.largerSurroundingText.substring(this.node.largerSurroundingTextHighlight[1])
            ]
            
            // Clean all the markings from the three sections 
            // (Need to do cleaning here or else the `this.node.largerSurroundingTextHighlights` indices might get messed up)
            const cleaned = splits.map(splt => splt.replaceAll(/[#^*_~]/g, ''));
            
            const joined = cleaned[0] + '<mark>' + cleaned[1] + '</mark>' + cleaned[2];
            const finalMarkdown = joined.replaceAll(/\n/g, '\n\n');
            
            // Create md and mark it as supporting HTML
            const md = new vscode.MarkdownString(finalMarkdown);
            md.supportHtml = true;
            return md;
        }
        else if (this.node.kind !== 'searchTemp') {
            const segments = this.node.parentLabels;
            let description = '';
            for (let indent = 0; indent < segments.length; indent++) {
                description += segments[indent];
                description += ('\n' + Array(indent + 1).fill('|   ').join(''))
            }
            return description + createLabelFromTitleAndPrefix(this.node.title, this.node.prefix);
        }
        else return this.node.label;
    }
    
    async getChildren (
        filter: boolean, 
        insertIntoNodeMap: (node: HasGetUri, uri: vscode.Uri) => void
    ): Promise<SearchNode<FileResultNode | SearchContainerNode | MatchedTitleNode | FileResultLocationNode>[]> {
        if (this.node.kind === 'file') {
            return this.node.locations;
        }
        else if (this.node.kind === 'searchContainer') {
            return this.node.contents;
        }
        else return [];
    }
}
