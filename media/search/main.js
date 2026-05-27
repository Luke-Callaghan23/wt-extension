/* eslint-disable curly */
// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();

    // Search bar
    const sendInputBoxUpdate = (field, value, push) => {
        /* {
            kind: 'textBoxChange',
            input: 'search' | 'replace',
            value: string,
        } */
        const okay = updateError();
        if (okay) {
            vscode.postMessage({
                kind: 'textBoxChange',
                input: field,
                value: value,
                push: push
            });
        }
    };

    const errorTooltip = document.getElementById('error-tooltip');
    const warningTooltip = document.getElementById('warning-tooltip');
    
    const searchBar = document.getElementById('search-bar');
    const searchIcon = document.getElementById("search-icon");

    const replaceBar = document.getElementById('replace-bar');
    const replaceIcon = document.getElementById("replace-icon");

    const updateBar = (searchBarKind) => (e) => {
        let pushUpdate = false;

        if (searchBarKind === 'search') {
            // If slowmode is on, only push the update (execute the search) only if the 
            //      search bar is empty (clear the results), or if the 'Enter' key is hit
            if (slowMode) {
                if (e.key === 'Enter' || searchBar.value === '') {
                    pushUpdate = true;
                }
            }
            // If slowmode is off, always send the update
            else {
                pushUpdate = true;
            }
        }
        // For replace bar, only send the update if Enter is hit
        else {
            if (e.key === 'Enter') {
                pushUpdate = true;
            }
        }
        sendInputBoxUpdate(searchBarKind, e.target.value, pushUpdate);
    };

    searchBar?.addEventListener('keyup', updateBar('search'));
    searchIcon?.addEventListener('click', (e) => sendInputBoxUpdate('search', searchBar.value, true));

    replaceBar?.addEventListener('keyup', updateBar('replace'));
    replaceIcon?.addEventListener('click', (e) => sendInputBoxUpdate('replace', replaceBar.value, true));

    const wholeWordCheckbox = document.getElementById("checkbox-whole-word");
    const regexCheckbox = document.getElementById("checkbox-regex");
    const caseInsensitiveCheckbox = document.getElementById("checkbox-case-insensitive");
    const matchTitlesCheckbox = document.getElementById("checkbox-match-titles");
    const nodeDescriptionsCheckbox = document.getElementById("checkbox-node-descriptions");
    const ignoreStyleCharactersCheckbox = document.getElementById("checkbox-ignore-style-characters");

    function checkboxValueChanged (checked, field) {
        /* {
            kind: 'checkbox',
            field: 'wholeWord' | 'regex' | 'caseInsensitive' | 'matchTitles' | 'nodeDescriptions' | 'ignoreStyleCharacters',
            checked: boolean
        } */
        
        const okay = updateError();
        if (okay) {
            vscode.postMessage({
                kind: 'checkbox',
                field: field,
                checked: checked
            });
        }
    }


    wholeWordCheckbox.addEventListener('click', (event) => checkboxValueChanged(event.target.checked, 'useWholeWord'));
    caseInsensitiveCheckbox.addEventListener('click', (event) => checkboxValueChanged(event.target.checked, 'useCaseInsensitive'));
    matchTitlesCheckbox.addEventListener('click', (event) => checkboxValueChanged(event.target.checked, 'useMatchTitles'));
    nodeDescriptionsCheckbox.addEventListener('click', (event) => checkboxValueChanged(event.target.checked, 'useNodeDescriptions'));
    ignoreStyleCharactersCheckbox.addEventListener('click', (event) => checkboxValueChanged(event.target.checked, 'useIgnoreStyleCharacters'));
    
    let timeout = null;

    // Used to show a tooltip when a user attempt to select both "Regex" and "Ignore Style Characters" checkboxes at the same time
    // These two options are incompatible with each other, and we have to turn off the other when the one is turned on
    function showRegexAndIgnoreStyleCharacterIncompatibilityText (ignoreStyleTurnedOn) {
        let tooltip;
        if (ignoreStyleTurnedOn) {
            tooltip = `"Ignore Style Characters" option is incompatible with "Regex" option.  Switching "Regex" off for now.`
        }
        else {
            tooltip = `"Regex" option is incompatible with "Ignore Style Characters" option.  Switching "Ignore Style Characters" off for now.`
        }
        searchBar.classList.add('search-warning');
        warningTooltip.innerHTML = tooltip;

        // Set a timer to hide the tooltip in 5 seconds
        if (timeout !== null) {
            clearTimeout(timeout);
        }

        timeout = setTimeout(() => {
            hideRegexAndIgnoreStyleCharacterIncompatibilityText();
            timeout = null;
        }, 15000);
    }

    function hideRegexAndIgnoreStyleCharacterIncompatibilityText () {
        // Remove the tooltip (this will be called 5 seconds from when the show function is called)
        searchBar.classList.remove('search-warning');
        warningTooltip.innerHTML = ``;
    }

    // regex and ignoreStyleCharacters checkmarks need to turn each other off when one is turned on
    // And also show a warning message when one is toggled on or off due to this incompatability
    ignoreStyleCharactersCheckbox.addEventListener('click', (event) => {
        const on = event.target.checked;
        if (on && regexCheckbox.checked) {
            regexCheckbox.checked = false;
            showRegexAndIgnoreStyleCharacterIncompatibilityText(true);
            checkboxValueChanged(false, 'useRegex');
        }
        checkboxValueChanged(on, 'useIgnoreStyleCharacters');
    });

    regexCheckbox.addEventListener('click', (event) => {
        const on = event.target.checked;
        if (on && ignoreStyleCharactersCheckbox.checked) {
            ignoreStyleCharactersCheckbox.checked = false;
            showRegexAndIgnoreStyleCharacterIncompatibilityText(false);
            checkboxValueChanged(false, 'useIgnoreStyleCharacters');
        }
        checkboxValueChanged(on, 'useRegex')
    });

    function updateError () {
        if (regexCheckbox.checked) {
            try {
                new RegExp(searchBar.value);
                searchBar.classList.remove('search-error');
                errorTooltip.innerHTML = ``;
                return true;
            }
            catch (err) {
                searchBar.classList.add('search-error');
                errorTooltip.innerHTML = `Failed to search for '${searchBar.value}' because an error occured while parsing the regex: <br>'${err}'`;
                return false;
            }
        }
        errorTooltip.innerHTML = ``;
        searchBar.classList.remove('search-error');
        return true;
    }

    {
        // Handle messages sent from the extension to the webview
        window.addEventListener('message', async (event) => {
            const message = event.data; // The json data that the extension sent
            console.log({message});
            console.log({event});
            switch (message.kind) {
                case 'slowModeValueUpdated':
                    slowMode = message.slowMode;
                    break;
                case 'searchError':
                    searchBar.classList.add("search-error");
                    errorTooltip.innerHTML = message.message;
                    break;
                case 'updateSearchBar':
                    searchBar.value = message.searchBar;
                    if (message.focus) {
                        console.log("erm, heller?")
                        searchBar.focus();
                    }
                    break;
            }
        });
    }

    setTimeout(() => {
        updateError();
    }, 100);
    vscode.postMessage({ kind: 'ready' });
}());