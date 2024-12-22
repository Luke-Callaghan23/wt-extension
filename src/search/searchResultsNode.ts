import * as vscode from 'vscode';
import { HasGetUri } from '../outlineProvider/UriBasedView';

export type FileResultNode = {
    kind: 'file';
    ext: string;
    uri: vscode.Uri;
    parentUri: vscode.Uri;
    label: string;
    locations: SearchNode<FileResultLocationNode>[]
}

export type FileResultLocationNode = {
    kind: 'fileLocation';
    uri: vscode.Uri;
    parentUri: vscode.Uri;
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
    label: string;
    results: number;
    contents: SearchNode<SearchContainerNode | FileResultNode>[];
};


export type SearchNodeTemporaryText = {
    kind: 'searchTemp',
    uri: vscode.Uri;
    parentUri: null;
    label: string;
}

export class SearchNode<T extends FileResultNode | SearchContainerNode | FileResultLocationNode | SearchNodeTemporaryText> implements HasGetUri {
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
        if (this.node.kind === 'file') {
            return `(${this.node.locations.length}) ${this.node.label}`
        }
        else if (this.node.kind === 'fileLocation') {
            return <vscode.TreeItemLabel> {
                label: this.node.surroundingText,
                highlights: [this.node.surroundingTextHighlight]
            }
        }
        else if (this.node.kind === 'searchContainer') {
            return `(${this.node.results}) ${this.node.label}`
        }
        else if (this.node.kind === 'searchTemp') {
            return this.node.label;
        }
        throw 'Not accessible';
    }

    getTooltip (): string | vscode.MarkdownString {
        if (this.node.kind !== 'fileLocation') {
            return this.node.label;
        }

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
    
    async getChildren (
        filter: boolean, 
        insertIntoNodeMap: (node: HasGetUri, uri: vscode.Uri) => void
    ): Promise<SearchNode<FileResultNode | SearchContainerNode | FileResultLocationNode>[]> {
        if (this.node.kind === 'file') {
            return this.node.locations;
        }
        else if (this.node.kind === 'searchContainer') {
            return this.node.contents;
        }
        else return [];
    }
}
