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

    function checkboxValueChanged (checked, field) {
        /* {
            kind: 'checkbox',
            field: 'wholeWord' | 'regex' | 'caseInsensitive' | 'matchTitles',
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


    wholeWordCheckbox.addEventListener('click', (event) => { checkboxValueChanged(event.target.checked, 'wholeWord')} );
    regexCheckbox.addEventListener('click', (event) => { checkboxValueChanged(event.target.checked, 'regex')} );
    caseInsensitiveCheckbox.addEventListener('click', (event) => { checkboxValueChanged(event.target.checked, 'caseInsensitive')} );
    matchTitlesCheckbox.addEventListener('click', (event) => { checkboxValueChanged(event.target.checked, 'matchTitles')} );

    const errorTooltip = document.getElementById('error-tooltip');
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
            switch (message.kind) {
                case 'slowModeValueUpdated':
                    slowMode = message.slowMode;
                    break;
                case 'searchError':
                    searchBar.classList.add("search-error");
                    errorTooltip.innerHTML = message.message;
                    break;
            }
        });
    }

    setTimeout(() => {
        updateError();
    }, 100);
    vscode.postMessage({ kind: 'ready' });
}());