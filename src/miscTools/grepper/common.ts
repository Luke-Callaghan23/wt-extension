

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMarkdownIgnoringRegex(plaintextQuery: string): string {
    const mdNoise = '[*_`~\\[\\]\\\\^]*';

    let result = '';

    for (let i = 0; i < plaintextQuery.length; i++) {
        const char = plaintextQuery[i];
        const next = plaintextQuery[i + 1];

        if (char === ' ') {
            result += `${mdNoise}\\s+${mdNoise}`;
        } 
        else {
            result += escapeRegex(char);
            // Inject noise after this char, unless next is a space or end of string
            if (next !== undefined && next !== ' ') {
                result += mdNoise;
            }
        }
    }

    return result;
}
