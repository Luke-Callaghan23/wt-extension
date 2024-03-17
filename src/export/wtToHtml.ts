import * as he from 'he';

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

export const wtToHtml = (wt: string, pageBreaks: boolean = true): string => {
    wt = wt.replaceAll("\r", '');

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

        // Iterate backwards over the stack to see whether:
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
    const filteredBlanks = noEmptySpace.filter(txt => txt.length > 0).join('').replaceAll('\\n', '');
    
    // Add page break before all of the chapter headers
    const withPageBreaks = pageBreaks 
        ? filteredBlanks
            .replaceAll('<p><h3', '<h3')
            .replaceAll('h3></p>', 'h3>')
            .replaceAll('<h3', '<div class="page-break" style="page-break-after: always;"></div><h3')
        : filteredBlanks;

    // Except for the first
    const removedFirstPageBreak = withPageBreaks.replace('<div class="page-break" style="page-break-after: always;"></div>', '');

    const finalHtml = he.encode(removedFirstPageBreak, {
        allowUnsafeSymbols: true,
    });

    const fullHtml = `<html><style>
        p {
            font-size: 10px;
        }
        h3 {
            font-size: 15px;
        }
        </style><body>${finalHtml}</body></html>`
    return fullHtml;
}