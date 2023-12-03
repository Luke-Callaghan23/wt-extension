import vscode from 'vscode';
import { AppearanceContainer, Note, SubNote, WorkBible } from './workBible';

export async function editNote (this: WorkBible, resource: Note | SubNote | AppearanceContainer) {
    
}

export function getNoteText (note: Note): string {
    const aliasesText = note.aliases
        .map(alias => alias.replace(';', '\\;'))
        .join('; ')

    const appearancesText = note.appearance
        .join('\n\n');

    const descriptionsText = note.descriptions
        .join('\n\n');

    return `${note.noun}

-- Enter ALIASES for ${note.noun} here, separated by semicolons -- ALSO, DON'T DELETE THIS LINE!

${aliasesText}

-- Enter APPEARANCE descriptions for ${note.noun} here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!

${appearancesText}

-- Enter GENERAL DESCRIPTIONS for ${note.noun} here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!

${descriptionsText}
`;
}


/*
${note.name}
-- Enter ALIASES for ${note.name} here, separated by commas -- ALSO, DON'T DELETE THIS LINE!
-- Enter APPEARANCE descriptions for ${note.name} here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!
-- Enter GENERAL DESCRIPTIONS for ${note.name} here, separated by new lines -- ALSO, DON'T DELETE THIS LINE!
*/