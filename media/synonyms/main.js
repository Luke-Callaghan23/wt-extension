/* eslint-disable curly */
// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();

    let synonyms = [];

    let dicationatyApi;

    // Clear button
    const clearButton = document.querySelector('.add-color-button');
    clearButton.addEventListener('click', () => {
        clearSynonyms();
    });

    // Search bar
    {
        const searchBar = document.getElementById('search-bar');
        const searchHandler = () => {
            const value = searchBar.value;
            const formattedValue = value.toLowerCase();
            addSynonym(formattedValue);
            searchBar.value = '';
        };
    
        searchBar?.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' || e.keyCode === 13) {
                searchHandler();
            }
        });
        document.getElementById('search-icon')?.addEventListener('click', searchHandler);
    }

    // Startup
    const startupMessage = document.getElementById("startup-message");
    async function startup () {
        const syns = [...synonyms];
        synonyms = [];
        for (const syn of syns) {
            await addSynonym(syn);
        }
        vscode.postMessage({ 
            type: 'deliveredSynonyms',
            synonyms: synonyms
        });
    }

    // Message handling
    {
        // Handle messages sent from the extension to the webview
        window.addEventListener('message', event => {
            const message = event.data; // The json data that the extension sent
            switch (message.type) {
                case 'addSynonym':
                    addSynonym(message.term);
                    break;
                case 'clearSynonyms':
                    clearSynonyms();
                    break;
                case 'startupDelivery':
                    synonyms = message.synonyms;
                    console.log(synonyms);
                    dicationatyApi = message.dicationatyApi;
                    startup();
                    break;
            }
        });
    }
    
    function addSynonym (term) {
        startupMessage.style.display = 'none';
        clearButton.disabled = false;
        query(term).then(term => {
            addContent(term).then(() => {
                synonyms.push(term.word);
                vscode.setState({ synonyms: synonyms });
                vscode.postMessage({ 
                    type: 'deliveredSynonyms',
                    synonyms: synonyms
                });
            });
        });
    }

    const synonymBox = document.getElementById('synonym-box');
    function clearSynonyms () {
        for (const syn of synonyms) {
            const synHeader = document.getElementById(`synonym-${syn}`);
            const synContent = document.getElementById(`synonym-${syn}-content`);
            removeContent(synHeader, synContent);
        }
        
        showStartupMessage();
        synonyms = [];
        vscode.setState({ synonyms: synonyms });
        vscode.postMessage({ 
            type: 'deliveredSynonyms',
            synonyms: synonyms
        });
    }

    function showStartupMessage () {
        clearButton.disabled = true;
        startupMessage.style.display = '';
    }

    async function query (word) {
        word = word.toLowerCase();
        // @ts-ignore
        const api = `https://dictionaryapi.com/api/v3/references/thesaurus/json/${word}?key=${dicationatyApi}`;
        const resp = await fetch(api);
        const json = await resp.json();

        function parseList (defs) {
            const ret = [];
            for (const def of defs) {
                if (def instanceof Array) {
                    const newList = parseList(def);
                    for (const item of newList) {
                        ret.push(item);
                    }
                }
                else {
                    ret.push(def);
                }
            }
            return ret;
        }

        // When the search fails, dictionaryapi sends us an array of suggested words
        // This array's type is string[] -- so, if the first item in the result array
        //      is a string, we assume that the search failed
        // Send a message to vscode with the failed word and suggestions
        if (typeof json[0] === 'string') {
            vscode.postMessage({ 
                type: 'failedSeach', 
                word: word,
                suggestions: json
            });
            return;
        }


        const definitions = json.map(
            (definition) => {
                if (definition.hwi.hw === word) {
                    return {
                        'definitions' :  parseList(definition[ 'shortdef' ]),
                        'part'        :  definition[ 'fl' ],
                        'synonyms'    :  parseList(definition[ 'meta' ][ 'syns' ]),
                        'antonyms'    :  parseList(definition[ 'meta' ][ 'ants' ]),
                    };
                }
                else {
                    return null;
                }
            }
        )
        .filter(x => x);

        return {
            word: word,
            definitions
        };
    }

    // Adding synonyms to the dom
    let addContent;
    {
        function capitalize(str) {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }
    
        function getContentHeader (id, display) {
            
            // Container for the header
            // This is where you click to show or hide content 
            const collapsible = document.createElement('div');
            collapsible.id = `synonym-${id}`;
            collapsible.className = "collapsible";
            collapsible.innerHTML = `
                <vscode-icon name="chevron-right" id="synonym-chevron-${id}"></vscode-icon>
                <strong id="synonym-${id}-container">${capitalize(display)}</strong>
            `;
    
            // Button to click on to remove the header and its content from a specified 
            //      container
            const termRemove = document.createElement('div');
            termRemove.id = `synonym-remove-${id}`;
            termRemove.className = "remove";
            termRemove.innerHTML = "&#10060;";
            collapsible.appendChild(termRemove);
    
            // Container for the content that is shown or hidden
            const content = document.createElement('div');
            content.id = `synonym-${id}-content`;
            content.className = "content";
    
            return [ collapsible, termRemove, content ];
        }
    
        async function _addContent (term) {
            const [ synonymHeader, removeSynonym, synonymContent ] = getContentHeader(term.word, term.word);
                
            for (let i = 0; i < term.definitions.length; i++) {
                const def = term.definitions[i];
                const defString = capitalize(def.definitions[0]);
    
                // Get the header elements for this definition
                const [ definitionHeader, removeDefinition, definitionContent ] = getContentHeader(`${term.word}-${i}`, defString);
    
                const syns = def.synonyms.map(syn => {
                    return `<a class="synonym">${syn}</a>`;
                }).join(', ');
                definitionContent.innerHTML = `<p class="synonym-container">${syns}</p>`;

                // Add the elements to the content box
                synonymContent.appendChild(definitionHeader);
                synonymContent.appendChild(definitionContent);

                synonymContent.querySelectorAll('.synonym').forEach(syn => {
                    syn.addEventListener('click', (event) => {
                        const search = event.target.innerText;
                        addSynonym(search);
                    });
                });
    
                // Click handler for showing or hiding the text content of this definition of this term
                definitionHeader.addEventListener('click', (event) => {
                    // @ts-ignore
                    if (event.target.id !== definitionHeader.id && !event.target.id.startsWith(definitionHeader.id)) return;
                    const chevronId = `synonym-chevron-${term.word}-${i}`;
                    const chevron = document.getElementById(chevronId);
                    if (definitionContent.style.display === "block") {
                        // @ts-ignore
                        definitionContent.style.display = "none";
                        chevron.name = 'chevron-right';
                    } else {
                        // @ts-ignore
                        definitionContent.style.display = "block";
                        chevron.name = 'chevron-down';
                    }
                });
                
                removeDefinition.addEventListener('click', () => {
                    // If the count of removed definitions matches the count of all definitions
                    //      then remove the outer content as well
                    // @ts-ignore
                    removeContent(definitionHeader, definitionContent, { parent: synonymContent, emptyHandler: () => {
                        // @ts-ignore
                        removeContent(synonymHeader, synonymContent, { emptyHandler: showStartupMessage });
                    }});
                });
    
            }
    
            // @ts-ignore
            synonymBox.appendChild(synonymHeader);
            // @ts-ignore
            synonymBox.appendChild(synonymContent);
    
            // Click handler for showing or hiding this synonyms content (the definition box)
            synonymHeader.addEventListener('click', (event) => {
                // @ts-ignore
                if (event.target.id !== synonymHeader.id && !event.target.id.startsWith(synonymHeader.id)) return;
                const chevronId = `synonym-chevron-${term.word}`;
                const chevron = document.getElementById(chevronId);
                if (synonymContent.style.display === "block") {
                    // @ts-ignore
                    synonymContent.style.display = "none";
                    chevron.name = 'chevron-right';
                } else {
                    // @ts-ignore
                    synonymContent.style.display = "block";
                    chevron.name = 'chevron-down';
                }
            });
            
            // Click handler for showing or removing the synonym from the synonyms box
            // @ts-ignore
            removeSynonym.addEventListener('click', (e) => {
                // @ts-ignore
                removeContent(synonymHeader, synonymContent, { emptyHandler: showStartupMessage });

                synonyms = synonyms.filter(syn => syn !== term.word);
                vscode.setState({ synonyms: synonyms });
                vscode.postMessage({ 
                    type: 'deliveredSynonyms',
                    synonyms: synonyms
                });
            });
        }
        addContent = _addContent;
    }

    // Removing synonym/definitions from the dom
    async function removeContent (header, content, options) {
        let parent;
        let emptyHandler;
        if (options) {
            parent = options.parent;
            emptyHandler = options.emptyHandler;
        }
        if (!parent) {
            parent = synonymBox;
        }
        parent?.removeChild(header);
        parent?.removeChild(content);
        
        if (parent?.children.length === 0) {
            emptyHandler?.();
        }
    }

    // Once the page is loaded, request the api key from the main environment
    vscode.postMessage({
        type: 'requestDictionaryApiKey'
    });
}());