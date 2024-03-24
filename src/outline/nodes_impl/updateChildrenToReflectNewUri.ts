import * as vscode from 'vscode';
import { ChapterNode, ContainerNode, OutlineNode, SnipNode } from './outlineNode';


export const updateSnipContent = ({ node, relativePath, parentUri }: {
    node: SnipNode,
    relativePath: string,
    parentUri: vscode.Uri
}) => {
    node.contents.forEach(content => {
        if (content.data.ids.type === 'snip') {

            const snipNodeName = content.data.ids.fileName;
            content.data.ids.uri = vscode.Uri.joinPath(parentUri, snipNodeName);
            content.data.ids.parentUri = parentUri;
            content.data.ids.relativePath = relativePath;

            updateSnipContent({
                node: content.data as SnipNode,
                parentUri: content.data.ids.uri,
                relativePath: `${content.data.ids.relativePath}/${snipNodeName}`
            });
        }
        else if (content.data.ids.type === 'fragment') {
            const fragment = content;
            const fragmentName = fragment.data.ids.fileName;
            fragment.data.ids.uri = vscode.Uri.joinPath(parentUri, fragmentName);
            fragment.data.ids.parentUri = parentUri;
            fragment.data.ids.relativePath = relativePath;
        }
    });
}

export const updateChapterTextFragments = ({ node, relativePath, parentUri }: {
    node: ChapterNode
    relativePath: string,
    parentUri: vscode.Uri
}) => {
    node.textData.forEach(fragment => {
        const fragmentName = fragment.data.ids.fileName;
        fragment.data.ids.uri = vscode.Uri.joinPath(parentUri, fragmentName);
        fragment.data.ids.parentUri = parentUri;
        fragment.data.ids.relativePath = relativePath;
    });
}

export function updateChildrenToReflectNewUri (this: OutlineNode) {
    const relativePath = this.data.ids.relativePath;
    const newUri = this.data.ids.uri;

    if (this.data.ids.type === 'chapter') {
        // First update all text data in the chapter
        const chapterNode = (this.data as ChapterNode);
        updateChapterTextFragments({
            node: chapterNode,
            parentUri: newUri,
            relativePath: relativePath
        });

        // Update the container node for the snips
        const snipsContainer = (chapterNode.snips.data as ContainerNode);
        snipsContainer.ids.parentUri = newUri;
        snipsContainer.ids.uri = vscode.Uri.joinPath(newUri, snipsContainer.ids.fileName);
        snipsContainer.ids.relativePath = `${relativePath}/${this.data.ids.fileName}`;
    
        // Update snips that exist inside of the snip container node
        snipsContainer.contents.forEach(content => {
            const snipNode = content.data as SnipNode;
            const snipFileName = snipNode.ids.fileName;
    
            // Update the snip itself
            snipNode.ids.uri = vscode.Uri.joinPath(snipsContainer.ids.uri, snipFileName);
            snipNode.ids.parentUri = snipsContainer.ids.uri;
            snipNode.ids.relativePath = `${snipsContainer.ids.relativePath}/${snipsContainer.ids.fileName}`;
    
            const fragmentRelativePath = `${snipNode.ids.relativePath}/${snipFileName}`;
            updateSnipContent({
                node: snipNode,
                parentUri: snipNode.ids.uri,
                relativePath: fragmentRelativePath,
            });
        })
    }
}