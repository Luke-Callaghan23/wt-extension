
let splitter = /\n~{3,}([^~]*)~{3,}\n/g;
const text = `Unnamed content
~~~named content~~~
Named content content
~~~~~~
More unnamed stuffffsssss
~~~named stuff again~~~
Named stuff again content
`
const outerTitle = 'hello';


let nextTitle = null;
if (outerTitle && outerTitle.length > 0) {
    nextTitle = `(${outerTitle}) Imported Fragment 0`
}
let cursor = 0;

const out = [];

let m;
let idx = 0;
while ((m = splitter.exec(text)) !== null) {
    const match = m;
    console.log(match);
    const matchStart = match.index;

    // Push the previous split text into the splits array
    const prevSplitFullText = text.substring(cursor, matchStart);
    const formattedSplit = prevSplitFullText.trim();
    // Only push the snip if the snip is not empty and the title is also not empty
    if (formattedSplit.length !== 0) {
        out.push({
            // Use the previous `nextTitle` value for the title of the current split
            title: nextTitle, 
            data: formattedSplit
        });
    }

    // From the substring that was matched attempt to read a title for the next split
    nextTitle = match[1] ? match[1].trim() : null;
    nextTitle = nextTitle && nextTitle.length > 0 ? nextTitle : null;

    if (nextTitle === null && outerTitle && outerTitle.length > 0) {
        nextTitle = `(${outerTitle}) Imported Fragment ${idx+1}`
    }

    // And advance the cursor past the matched area
    cursor = match.index + match[0].length;
    idx++;
}

console.log(out);