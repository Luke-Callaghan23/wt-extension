import * as he from 'he';
import { defaultFragmentSeparator } from './exportDocuments';

type Tags = 'paragraph' | 'emphasis' | 'bold' | 'underline' | 'strikethrough' | 'header';
const conversionsTable: { [index: string]: Tags } = {
    '\n': 'paragraph',
    '*': 'emphasis',
    '^': 'bold',
    '_': 'underline',
    '~': 'strikethrough',
    '#': 'header',
};

type TagStackItem = {
    openingTagIdx: number;
    tag: Tags;
    text: string;
};

const getTagText = (tag: Tags, kind: 'opening' | 'closing') => {
    const closeChar = kind === 'closing' ? '/' : '';
    switch (tag) {
        case 'bold': return `<${closeChar}b>`;
        case 'emphasis': return `<${closeChar}i>`;
        case 'paragraph': return `<${closeChar}p>`;
        case 'strikethrough': return `<${closeChar}del>`;
        case 'underline': return `<${closeChar}u>`;
        case 'header': return `<${closeChar}h3>`;
    }
}

export const wtToHtml = (wt: string, options: {
    pageBreaks: boolean,
    destinationKind: 'html' | 'docx' | 'odt'
}): string => {
    wt = wt.replaceAll("\r", '');
    
    // Encode html characters to html entities
    // This lets users put text such as "<" and ">" in their work without the html breaking down entirely
    wt = he.encode(wt, {
        allowUnsafeSymbols: true,
    });

    // Replacing tabs with 8 unbreakable spaces
    // Important html-to-docx library does not behave well with tab characters, but 8 unbreakable spaces does the job well enough
    wt = wt.replaceAll("&#x9;", "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;");

    // Temporarily replacing style characters that have been escaped
    const replaceKeys: { [ index: string ]: string } = {};
    for (const [styleChar, description] of Object.entries(conversionsTable)) {
        if (styleChar === '\n') continue;
        const escapedStyleChar = '\\' + styleChar;
        const replaceKey = `%%REPLACE%ME%%%${description}%%`;
        wt = wt.replaceAll(escapedStyleChar, replaceKey);
        replaceKeys[replaceKey] = styleChar;
    }


    // Initialize the stack of html tags with an opening paragraph tag
    //      which starts at the 0th index of wt text
    const stack: TagStackItem[] = [{
        openingTagIdx: 0,
        tag: 'paragraph',
        text: '',
    }];

    let headerOpened: boolean = false;

    // Initialize array of strings that will be joined for html with the 
    //      opening paragraph tag described above
    const html: string[] = [
        '<p>'
    ];
    for (let idx = 0; idx < wt.length; idx++) {
        const char = wt[idx];
        if (!(char in conversionsTable)) {
            // If the current character is not a closing character, then add the character
            //      to the text segment of the current stack item
            stack[stack.length - 1].text += char;
            continue;
        }

        if (char === '#') {
            // Only apply headers if they are the first character on the line
            // Check if the previous character was '\n' or undefined
            if (!(wt[idx - 1] === '\n' || wt[idx - 1] === undefined)) {
                continue;
            }
        }

        // Special rule for triplets of tags:
        // Sometimes '~~~' or '###' or even '___' is used to denote a scene break
        // We want to allow people to use this without adding superfluous tags.  So, lookahead to see if the next
        //      two characters are also the same as the current character and, if they are, fast forward past them
        if (wt[idx + 1] === char && wt[idx + 2] === char
            && char !== '\n'                                                // \n is a <p> tag, and should be handled normally
        ) {
            idx += 3;
            stack[stack.length - 1].text += `${char}${char}${char}`;
            continue;
        }

        const tag = conversionsTable[char];
        if (tag === 'header') {
            headerOpened = true;
        }

        // Iterate rights over the stack to see whether:
        //      (A) there exists an unclosed opening tag which this current tag will close
        //      (B) there are no still opened tag pair for this, and the current tag is an opening tag
        let foundIdx: number = -1;
        for (let tagIdx = stack.length - 1; tagIdx >= 0; tagIdx--) {
            const iterTag = stack[tagIdx];
            if (iterTag.tag === tag) {
                foundIdx = tagIdx;
                break;
            }
        }
        

        if (foundIdx !== -1) {
            // If there does exist an opening tag for the current tag somewhere in the stack, then we must
            //      close all tags between the current tag and the opening tag, close the the opening tag,
            //      then re-open all opening tags between the current tag and its pair
            // We close and re-open all tags between the current and its pair because those tags are being
            //      'interrupted' by the closing of this tag and the nature of html does not allow any tags 
            //      that were opened in a certain scope to last beyond that original scope -- to counteract
            //      this, close any tags that were opened in the current scope, then reopen them outside it
            const closed = stack.slice(foundIdx, stack.length);

            // Close all the above tags, in reverse (including the current tag)
            // In reverse because of the same reasons as above -- opened tags cannot cross scopes
            [...closed].reverse().forEach(close => {
                const { openingTagIdx, tag, text } = close; 
                const closeTagText = getTagText(tag, 'closing');
                html.push(text, closeTagText);
            });

            // Remove all items from the end of the stack which were currently closed
            stack.splice(foundIdx, stack.length - foundIdx);
            
            // Now, re-open all tags besides the current one

            // Special case for closing 'paragraph' tags -> re-open it immediately
            // 'paragraph's shoul alway be the root
            if (tag === 'paragraph') {
                stack.push({
                    openingTagIdx: idx + 1,
                    text: '',
                    tag: 'paragraph'
                });
                html.push(getTagText('paragraph', 'opening'));
            }

            // Re-open all tags besides the one that is being closed
            // This time in the same order that they were originally opened in
            closed.slice(1).forEach(open => {
                // DO NOT REOPEN header tags, as they should only apply to the line
                //      they're opened on
                if (open.tag === 'header') return;

                // Push all other tags to stack and html
                stack.push({
                    openingTagIdx: idx + 1,
                    tag: open.tag,
                    text: '',
                });
                html.push(getTagText(open.tag, 'opening'));
            });
        }
        else {
            // The stack should always at least have an opening paragraph tag 
            // If not, then throw an error
            if (stack.length === 0) throw 'export error: stack was empty';

            // Add the text that currently resides inside of the parent stack item to
            //      the html array -- as we've reached the end of the current text 
            //      section of the current scope -- all following text will be a part
            //      of the scope created by this closing tag
            const top = stack[stack.length - 1];
            html.push(top.text);

            // Also reset the current text of the top of the stack
            // This is so that if this new inner scope closes while the outer scope has
            //      more text to add, we can continue adding to that text section
            top.text = '';

            // Add the opening tag to the html data and the stack
            const opening: TagStackItem = {
                openingTagIdx: idx,
                tag: tag,
                text: ''
            };
            const openingTagText = getTagText(tag, 'opening');

            stack.push(opening);
            html.push("");
            html.push(openingTagText);
        }
    }

    // After all the main text of the wt fragment has been converted, we must close any lingering tags to
    //      ensure that the html is correct
    [...stack].reverse().forEach(close => {
        const { openingTagIdx, tag, text } = close; 
        const closeTagText = getTagText(tag, 'closing');
        html.push(text, closeTagText);
    });
    
    // Empty spaces should be replaces with '&#8203;' (zero-width space) because
    //      of a bug in the html to docx npm package where a <i> section right
    //      after a <b> tag (or any two tags right next to each other) cancel 
    //      each other out
    const noEmptySpace = html.map(txt => txt === ''
        ? '&#8203;'
        : txt
    );

    // Join and filter newline sequences
    const filteredBlanks = noEmptySpace.filter(txt => txt.length > 0).join('').replaceAll('\\n', '');
    
    // Replace all '--' sequences with em dashes
    // Also consume any surrounding space characters
    const emDashed = filteredBlanks.replaceAll(/ *\-\- */g, "&#8212;");
    
    // Libre office expects the page break tag to be in a <p> tag whereas html to docx converter expects the page break tag to
    //      be in a <div>
    const pageBreakText = options.destinationKind === 'odt' || options.destinationKind === 'html'
        ? `<p style="page-break-after: always"></p><br clear="all" style="page-break-before:always" />`
        : `<div class="page-break" style="page-break-after: always;"></div>`

    // Add page break before all of the chapter headers
    const withPageBreaks = options.pageBreaks 
        ? emDashed
            // Because of the way html to docx works, all page-break tags must be on the top level of the document
            //      however, currently, all h3 tags are enclosed by <p> tags 
            // So, first remove the surrounding <p> tags to but the h3 tags at the root level of the body
            .replaceAll(/<p>((&#8203;)|\s|&nbsp;)*<h3/g, '<h3')                                                                            
            .replaceAll(/h3>((&#8203;)|\s|&nbsp;)*<\/p>/g, 'h3>')
            // Once the h3s are at the root level of the body, then we need to replace all instances of the opening h3 tag
            //      to the page-break element followed by that h3 tag
            .replaceAll(/((&#8203;)|\s|&nbsp;)*<h3/g, `${pageBreakText}<h3`)
        : emDashed;

    // Other misc style work
    const noFirstPageBreak = withPageBreaks.replace(`${pageBreakText}`, '');
    const styleH3 = noFirstPageBreak.replaceAll(/<h3>/g, "<h3 style=\"font-size: 30px;\">");
    const clearNewlines = styleH3.replaceAll(/<p>((&#8203;)|\s|&nbsp;)*<\/p>/g, "");

    // See comment above `defaultFragmentSeparator` for more details
    // As we can see above there is a ton of maneuvering of whitespace around fragment separators and a lot of editing required
    //      to do the edits
    // Allowing newline separators would have increased complexity to a whole new level so instead, we use a long string that
    //      will likely never occur in a user's normal text as the separator to do all of the existing string manipulation
    //      required above
    // Then swap out that default separator now
    const swapDefaultSeparatorForEmptyLineSeparator = clearNewlines.replaceAll(defaultFragmentSeparator, '');
    
    let finalHtml: string;
    if (options.destinationKind === 'docx') {
        const addNewNewlinesToLineAfterHeadings = swapDefaultSeparatorForEmptyLineSeparator.replaceAll("</h3>", "</h3><p></p>");
        const styleP = addNewNewlinesToLineAfterHeadings.replaceAll(/<p>/g, "<p style=\"line-height: 1.35; position: relative; top: -.5em; text-align: justify;\">");
        finalHtml = styleP;
    }
    else {
        const addNewNewlinesToLineAfterHeadings = swapDefaultSeparatorForEmptyLineSeparator.replaceAll("</h3>", "</h3><br />");
        finalHtml = addNewNewlinesToLineAfterHeadings;
    }

    // Undo all the '%%REPLACE_ME__%%'s from earlier with the unescaped forms of each
    for (const [ replaceKey, replaceWith ] of Object.entries(replaceKeys)) {
        finalHtml = finalHtml.replaceAll(replaceKey, replaceWith);
    }

    const fullHtml = `<html><style>
        p { 
            font-size: 18px; 
            line-height: 1.35; 
            position: relative; 
            top: -.5em; 
            text-align: justify;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        }

        h3 { 
            font-size: 27px;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        }
        @page { 
            margin-left: 0.75in; 
            margin-right: 0.75in; 
            margin-top: 0.75in; 
            margin-bottom: 0.75in; 
        }
        </style><body style="text-align: justify;">${finalHtml}</body></html>`
    return fullHtml;
}