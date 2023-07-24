import * as vscode from 'vscode';
import { Packageable } from '../../packageable';
import * as console from './../../vsconsole';
import { capitalize } from '../common';

type Colors = { [index: string]: 1 };

// source: 
const colorGroups: { [index: string]: Colors } = {
    "white": {
        "white": 1,
        "pearl": 1,
        "alabaster": 1,
        "snow": 1,
        "ivory": 1,
        "cream": 1,
        "eggshell": 1,
        "cotton": 1,
        "chiffon": 1,
        "salt": 1,
        "lace": 1,
        "coconut": 1,
        "linen": 1,
        "bone": 1,
        "daisy": 1,
        "powder": 1,
        "frost": 1,
        "porcelain": 1,
        "parchment": 1,
        "rice": 1
    },
    "yellow": {
        "yellow": 1,
        "canary": 1,
        "gold": 1,
        "daffodil": 1,
        "flaxen": 1,
        "butter": 1,
        "lemon": 1,
        "mustard": 1,
        "corn": 1,
        "medallion": 1,
        "dandelion": 1,
        "fire": 1,
        "bumblebee": 1,
        "banana": 1,
        "butterscotch": 1,
        "dijon": 1,
        "honey": 1,
        "blonde": 1,
        "pineapple": 1,
        "tuscan sun": 1,
        "bright yellow": 1,
        "mellow yellow": 1,
        "cyber yellow": 1,
        "royal yellow": 1,
        "tuscany yellow": 1,
        "lemon yellow": 1,
        "cream yellow": 1,
        "peach": 1,
        "laguna yellow": 1,
        "mustard yellow": 1,
        "corn yellow": 1,
        "pineapple yellow": 1,
        "flaxen yellow": 1,
        "eggnog yellow": 1,
        "trombone yellow": 1,
        "flax yellow": 1,
        "ecru yellow": 1,
        "sepia yellow": 1
    },
    "orange": {
        "orange": 1,
        "tangerine": 1,
        "marigold": 1,
        "cider": 1,
        "rust": 1,
        "ginger": 1,
        "tiger": 1,
        "fire": 1,
        "bronze": 1,
        "cantaloupe": 1,
        "apricot": 1,
        "clay": 1,
        "honey": 1,
        "carrot": 1,
        "squash": 1,
        "spice": 1,
        "marmalade": 1,
        "amber": 1,
        "sandstone": 1,
        "yam": 1,
        "bright orange": 1,
        "gold orange": 1,
        "goldenrod orange": 1,
        "pumpkin": 1,
        "fire orange": 1,
        "ochre orange": 1,
        "burnt orange": 1,
        "dijon orange": 1,
        "tiger orange": 1,
        "honey orange": 1,
        "carrot orange": 1,
    },
    "red": {
        "red": 1,
        "cherry": 1,
        "rose": 1,
        "jam": 1,
        "merlot": 1,
        "garnet": 1,
        "crimson": 1,
        "ruby": 1,
        "scarlet": 1,
        "wine": 1,
        "brick": 1,
        "apple": 1,
        "mahogany": 1,
        "blood": 1,
        "sangria": 1,
        "berry": 1,
        "currant": 1,
        "blush": 1,
        "candy": 1,
        "lipstick": 1,
        "salmon red": 1,
        "barn red": 1,
        "imperial red": 1,
        "indian red": 1,
        "chili red": 1,
        "fire brick red": 1,
        "maroon": 1,
        "redwood": 1,
        "raspberry": 1,
        "candy apple red": 1,
        "ferrari red": 1,
        "persian red": 1,
        "us flag red": 1,
        "carmine red": 1,
        "burgundy": 1,
        "crimson red": 1,
        "sangria red": 1,
    },
    "pink": {
        "pink": 1,
        "rose": 1,
        "fuchsia": 1,
        "punch": 1,
        "blush": 1,
        "watermelon": 1,
        "flamingo": 1,
        "rouge": 1,
        "salmon": 1,
        "coral": 1,
        "peach": 1,
        "strawberry": 1,
        "rosewood": 1,
        "lemonade": 1,
        "taffy": 1,
        "bubblegum": 1,
        "ballet slipper": 1,
        "crepe": 1,
        "magenta": 1,
        "hot pink": 1,
        "bright pink": 1,
        "ruby": 1,
        "ultra pink": 1,
        "thulian pink": 1,
        "rose pink": 1,
        "lavender pink": 1,
        "creamy pink": 1,
        "french rose": 1,
        "cerise": 1,
        "carnation pink": 1,
        "brick pink": 1,
        "amaranth": 1,
        "taffy pink": 1,
        "bubble gum pink": 1,
        "punch pink": 1,
        "pink lemonade": 1,
        "flamingo pink": 1
    },
    "purple": {
        "purple": 1,
        "mauve": 1,
        "violet": 1,
        "boysenberry": 1,
        "lavender": 1,
        "plum": 1,
        "magenta": 1,
        "lilac": 1,
        "grape": 1,
        "periwinkle": 1,
        "sangria": 1,
        "eggplant": 1,
        "jam": 1,
        "iris": 1,
        "heather": 1,
        "amethyst": 1,
        "raisin": 1,
        "orchid": 1,
        "mulberry": 1,
        "wine": 1,
        "hibiscus": 1,
        "mauve purple": 1,
        "mulberry purple": 1,
        "orchid violet": 1,
        "lilac purple": 1,
        "electric violet": 1,
        "african violet": 1,
        "byzantine purple": 1,
        "fandango purple": 1,
        "helio purple": 1,
        "floral purple": 1,
        "thistle": 1,
        "royal purple": 1,
        "lollipop purple": 1,
        "plum purple": 1,
    },
    "blue": {
        "blue": 1,
        "slate": 1,
        "sky": 1,
        "navy": 1,
        "indigo": 1,
        "cobalt": 1,
        "teal": 1,
        "ocean": 1,
        "peacock": 1,
        "azure": 1,
        "cerulean": 1,
        "lapis": 1,
        "spruce": 1,
        "stone": 1,
        "aegean": 1,
        "berry": 1,
        "denim": 1,
        "admiral": 1,
        "sapphire": 1,
        "arctic": 1,
        "bright blue": 1,
        "yale blue": 1,
        "pigeon blue": 1,
        "sky blue": 1,
        "independence blue": 1,
        "air force blue": 1,
        "baby blue": 1,
        "navy blue": 1,
        "steel blue": 1,
        "carolina blue": 1,
        "turkish blue": 1,
        "maya blue": 1,
        "cornflower blue": 1,
        "olympic blue": 1,
        "azure blue": 1,
        "egyptian blue": 1,
        "prussian blue": 1,
        "space blue": 1
    },
    "green": {
        "green": 1,
        "chartreuse": 1,
        "juniper": 1,
        "sage": 1,
        "lime": 1,
        "fern": 1,
        "olive": 1,
        "emerald": 1,
        "pear": 1,
        "moss": 1,
        "shamrock": 1,
        "seafoam": 1,
        "pine": 1,
        "parakeet": 1,
        "mint": 1,
        "seaweed": 1,
        "pickle": 1,
        "pistachio": 1,
        "basil": 1,
        "crocodile": 1,
        "bright green": 1,
        "forest green": 1,
        "sage green": 1,
        "olive green": 1,
        "lime green": 1,
        "hunter green": 1,
        "jade green": 1,
        "artichoke green": 1,
        "fern green": 1,
        "jungle green": 1,
        "laurel green": 1,
        "moss green": 1,
        "mint green": 1,
        "pine green": 1,
        "tea green": 1,
        "army green": 1,
        "emerald green": 1,
        "kelly green": 1,
        "sacramento green": 1,
        "sea green": 1
    },
    "brown": {
        "brown": 1,
        "coffee": 1,
        "mocha": 1,
        "peanut": 1,
        "carob": 1,
        "hickory": 1,
        "wood": 1,
        "pecan": 1,
        "walnut": 1,
        "caramel": 1,
        "gingerbread": 1,
        "syrup": 1,
        "chocolate": 1,
        "tortilla": 1,
        "umber": 1,
        "tawny": 1,
        "brunette": 1,
        "cinnamon": 1,
        "penny": 1,
        "cedar": 1,
        "espresso": 1,
        "russet brown": 1,
        "tan": 1,
        "beige": 1,
        "macaroon": 1,
        "hazelwood": 1,
        "granola": 1,
        "oat": 1,
        "eggnog": 1,
        "fawn": 1,
        "sugar cookie": 1,
        "sand": 1,
        "sepia": 1,
        "ltte": 1,
        "oyster": 1,
        "biscotti": 1,
        "parmesan": 1,
        "hazelnut": 1,
        "sandcastle": 1,
        "buttermilk": 1,
        "sand dollar": 1,
        "shortbread": 1
    },
    "grey": {
        "grey": 1,
        "shadow": 1,
        "graphite": 1,
        "iron": 1,
        "pewter": 1,
        "cloud": 1,
        "silver": 1,
        "smoke": 1,
        "slate": 1,
        "anchor": 1,
        "ash": 1,
        "porpoise": 1,
        "dove": 1,
        "fog": 1,
        "flint": 1,
        "charcoal": 1,
        "pebble": 1,
        "lead": 1,
        "coin": 1,
        "fossil": 1,
        "gray": 1,
        "fossil gray": 1,
        "mink": 1,
        "pearl river": 1,
        "abalone": 1,
        "harbor gray": 1,
        "thunder gray": 1,
        "steel gray": 1,
        "stone": 1,
        "rhino gray": 1,
        "trout gray": 1,
        "seal gray": 1,
        "lava gray": 1,
        "anchor gray": 1,
        "charcoal gray": 1
    },
    "black": {
        "black": 1,
        "ebony": 1,
        "crow": 1,
        "charcoal": 1,
        "midnight": 1,
        "ink": 1,
        "raven": 1,
        "oil": 1,
        "grease": 1,
        "onyx": 1,
        "pitch": 1,
        "soot": 1,
        "sable": 1,
        "jet black": 1,
        "coal": 1,
        "metal": 1,
        "obsidian": 1,
        "jade": 1,
        "spider": 1,
        "leather": 1
    }
};

export class ColorGroups implements Packageable {
    
    getColorGroup (color: string): {
        leader: string,
        group: string[]
    } | null {
        
        const mainGroup = Object.entries(colorGroups).find(([ _, group ]) => group[color]);
        const extraGroup = Object.entries(this.extraColors).find(([ _, group ]) => group[color]);
        if (!mainGroup && !extraGroup) return null;


        // Reaturn the group leader (blue, black, brown, etc.) as well as all the synonyms for that color
        let leader: string = '';
        const group: string[] = [];
        if (mainGroup) {
            const [ groupLeader, groupGroup ] = mainGroup;
            leader = groupLeader;
            Object.keys(groupGroup).forEach(color => group.push(color));

            // Also check to see if the group leader of the main group exists in the extra groups as well
            if (this.extraColors[groupLeader]) {
                const extras: Colors = this.extraColors[groupLeader];
                Object.keys(extras).forEach(color => group.push(color));
            }

        }
        if (extraGroup) {
            const [ groupLeader, groupGroup ] = extraGroup;
            leader = groupLeader;
            Object.keys(groupGroup).forEach(color => group.push(color));

            // Also check to see if the group leader of the extra group exists in the main groups as well
            if (colorGroups[groupLeader]) {
                const extras: Colors = colorGroups[groupLeader];
                Object.keys(extras).forEach(color => group.push(color));
            }
        }
        return {
            leader: leader,
            group: group
        };
    }
    
    private extraColors: { [index: string]: Colors };
    constructor (private context: vscode.ExtensionContext) {
        this.registerCommands();

        // Get additional colors from the workspace state
        const extras: { [index: string]: Colors } = context.workspaceState.get('wt.colors.extraColors') || {};
        this.extraColors = extras;
    }

    getPackageItems(): { [index: string]: any; } {
        return {
            'wt.colors.extraColors': this.extraColors
        };
    }

    async addColor (): Promise<void> {

        let selectedText = '';

        // Pull selected string from active document, if possible
        const editor = vscode.window.activeTextEditor
        if (editor && !editor.selection.isEmpty && editor.document) {
            const selection = editor.selection;
            const document = editor.document;
            const text = document.getText();
            const selectStart = document.offsetAt(selection.start);
            const selectEnd = document.offsetAt(selection.end);
            selectedText = text.substring(selectStart, selectEnd);
        }

        // Combine all group names from both the default set and the extra groups
        const groupNames = Object.keys(colorGroups);
        const extraGroups = Object.keys(this.extraColors);
        const allGroupNames = [...new Set([...groupNames, ...extraGroups])];

        // Get the name of the group to add the color to
        const displayGroups = allGroupNames.map(cg => capitalize(cg));
        displayGroups.push('Add A New Group');
        let addedGroup: string | undefined = await vscode.window.showQuickPick(
            displayGroups, 
            {
                ignoreFocusOut: false,
                title: 'Which group would you like to add the color to?',
                canPickMany: false
            }
        );
        if (!addedGroup) return;
        let actualGroup = addedGroup.toLocaleLowerCase();

        if (addedGroup === 'Add A New Group') {
            // Get the color text
            const newGroup = await vscode.window.showInputBox({
                ignoreFocusOut: false,
                prompt: `Enter the name of the group you'd like to create:`,
                title: `Enter the name of the group you'd like to create:`,
                value: ''
            });
            if (!newGroup) return;
            addedGroup = newGroup;
            actualGroup = newGroup.trim().toLocaleLowerCase();
        }

        // Get the color text
        const color = await vscode.window.showInputBox({
            ignoreFocusOut: false,
            prompt: `Enter the color you would like to add to '${addedGroup}':`,
            title: `Enter the color you would like to add to '${addedGroup}':`,
            value: selectedText,
            valueSelection: [ 0, selectedText.length ],
        });
        if (!color) return;
        const actual = color.trim().toLocaleLowerCase();

        // Add the color to this.extraColors
        if (this.extraColors[actualGroup] === undefined) {
            this.extraColors[actualGroup] = {};
        }
        this.extraColors[actualGroup][actual] = 1;

        // As well as the workspace state
        this.context.workspaceState.update('wt.colors.extraColors', this.extraColors);
    }

    async removeColor (): Promise<void> {
        // Invert the color groups so that each color in each color group
        //      points to the name of the color group
        const invertedColorGroups: { [index: string]: string } = {};
        Object.entries(this.extraColors).forEach(([ colorGroup, colors ]) => {
            Object.keys(colors).forEach(color => {
                invertedColorGroups[color] = colorGroup;
            });
        });

        const allExtras = Object.keys(invertedColorGroups);
        const removedColor: string | undefined = await vscode.window.showQuickPick(
            allExtras.map(colors => capitalize(colors)), 
            {
                ignoreFocusOut: false,
                title: 'Which group would you like to add the color to?',
                canPickMany: false
            }
        );
        if (!removedColor) return;
        const actualRemoved = removedColor.toLocaleLowerCase();

        // Remove the color from this.extraColors
        const group = invertedColorGroups[actualRemoved];
        delete this.extraColors[group][actualRemoved];

        // Remove the color from the workspace state
        this.context.workspaceState.update('wt.colors.extraColors', this.extraColors);
    }


    registerCommands () {
        vscode.commands.registerCommand('wt.colors.addColor', () => this.addColor());
        vscode.commands.registerCommand('wt.colors.removeColor', () => this.removeColor());
    }
}