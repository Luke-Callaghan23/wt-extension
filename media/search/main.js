/* eslint-disable curly */
// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();

    // Search bar
    {
        const searchBarValueUpdated = (field, value) => {
            /* {
                kind: 'textBoxChange',
                input: 'search' | 'replace',
                value: string,
            } */
            vscode.postMessage({
                kind: 'textBoxChange',
                input: field,
                value: value
            });
        };
        
        const searchBar = document.getElementById('search-bar');
        const searchIcon = document.getElementById("search-icon");
        searchBar?.addEventListener('keyup', (e) => {
            if (slowMode) {
                if (e.key === 'Enter' || searchBar.value === '') {
                    searchBarValueUpdated('search', e.target.value);
                }
            }
            else { 
                searchBarValueUpdated('search', e.target.value);
            }
        });
        searchIcon?.addEventListener('click', (e) => searchBarValueUpdated('search', searchBar.value));
    }

    // Checkboxes
    {
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
            vscode.postMessage({
                kind: 'checkbox',
                field: field,
                checked: checked
            });
        }

        wholeWordCheckbox.addEventListener('click', (event) => { checkboxValueChanged(event.target.checked, 'wholeWord')} );
        regexCheckbox.addEventListener('click', (event) => { checkboxValueChanged(event.target.checked, 'regex')} );
        caseInsensitiveCheckbox.addEventListener('click', (event) => { checkboxValueChanged(event.target.checked, 'caseInsensitive')} );
        matchTitlesCheckbox.addEventListener('click', (event) => { checkboxValueChanged(event.target.checked, 'matchTitles')} );
    }

    {
        // Handle messages sent from the extension to the webview
        window.addEventListener('message', async (event) => {
            const message = event.data; // The json data that the extension sent
            switch (message.kind) {
                case 'slowModeValueUpdated':
                    slowMode = message.slowMode;
                    break;
            }
        });
    }

    vscode.postMessage({ kind: 'ready' });
}());