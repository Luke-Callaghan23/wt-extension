/* eslint-disable curly */
// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();

    let synonyms = [];
    const synonymElements = [];

    // Search bar
    {
        const searchHandler = (field, value) => {
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
        console.log(searchBar)
        searchBar?.addEventListener('keyup', (e) => searchHandler('search', e.target.value));
        const replaceBar = document.getElementById('replace-bar');
        replaceBar?.addEventListener('click', (e) => replaceHandler('replace', e.target.value));


        document.getElementById('search-icon')?.addEventListener('click', e => searchHandler('search', searchBar.target.value));
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
            console.log('hello');
            vscode.postMessage({
                kind: 'checkbox',
                field: field,
                checked: checked
            });
        }
    


        wholeWordCheckbox.addEventListener('click', (event) => { console.log("poop"); checkboxValueChanged(event.target.checked, 'wholeWord')} );
        regexCheckbox.addEventListener('click', (event) => { console.log("poop"); checkboxValueChanged(event.target.checked, 'regex')} );
        caseInsensitiveCheckbox.addEventListener('click', (event) => { console.log("poop"); checkboxValueChanged(event.target.checked, 'caseInsensitive')} );
        matchTitlesCheckbox.addEventListener('click', (event) => { console.log("poop"); checkboxValueChanged(event.target.checked, 'matchTitles')} );
        console.log('good')
    }

}());