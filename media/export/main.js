/* eslint-disable curly */
// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {

    const illegalCharacters = [
        '#',
        '%',
        '&',
        '{',
        '}',
        '\\',
        '<',
        '>',
        '*',
        '?',
        '/',
        ' ',
        '$',
        '!',
        '\'',
        '"',
        ':',
        '@',
        '+',
        '`',
        '|',
        '=',
        '.'
    ];

    // Message handling
    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'sentDocuments':
                loadDocuments(message.documents, message.chapterUris);
                break;
        }
    });

    const errorHelpText = document.getElementById('error-label');
    const submit = document.getElementById('export-button');
    let error = true;

    // On keyup of the file name input, add or remove appropriate error elements
    // Such as the red border around the input box and the red message underneath the input box
    // Also disables/enables the export button
    document.getElementById('input-export-file-name').addEventListener('keyup', (event) => {
        if (event.target.value === '' || illegalCharacters.find(illegal => event.target.value.includes(illegal))) {
            event.target.classList.add('error');
            errorHelpText.style.display = '';
            error = true;
        }
        else {
            event.target.classList.remove('error');
            errorHelpText.style.display = 'none';
            error = false;
        }
    });

    // Handle showing the additional "skip first" or "skip last" options which will display
    //      when the "title chapters" option is set
    const logueOptions = document.getElementById('logue-options');
    const titleChapters = document.getElementById('checkbox-title-chapters');
    titleChapters.addEventListener('click', (event) => {
        event.preventDefault();
        if (event.target.checked) {
            logueOptions.innerHTML = `
                <vscode-label for="checkbox-skip-first" class="label">Skip chapter tag for first chapter</vscode-label>
                <vscode-checkbox 
                    label="Indicates that you want to skip adding a chapter tag for the first chapter (useful for prologues)"
                    id="checkbox-skip-first" 
                    name="skip-first" 
                    class="checkbox"
                ></vscode-checkbox>
                <div class="spacer"></div>
                <vscode-label for="checkbox-skip-last" class="label">Skip chapter tag for last chapter</vscode-label>
                <vscode-checkbox 
                    label="Indicates that you want to skip adding a chapter tag for the last chapter (useful for epilogues)"
                    id="checkbox-skip-last" 
                    name="skip-last" 
                    class="checkbox"
                ></vscode-checkbox>
                <div class="spacer"></div>
            `;
        }
        else {
            logueOptions.innerHTML = ``;
        }
    })

    // Handle showing the odt warning when the value for select-ext-type is 'odt'
    const odtWarningMessage = document.getElementById("odt-warning");
    const extTypeBox = document.getElementById("select-ext-type");
    extTypeBox.addEventListener("click", (e) => {
        if (e.target.value === 'odt') {
            odtWarningMessage.style.display = '';
            return;
        }
        odtWarningMessage.style.display = 'none';
    });

    const formContainer = document.getElementById("form-container");


    const form = document.getElementById('log-settings-form');
    submit.addEventListener('click', (event) => {
        event.preventDefault();
        if (error) return;

        // Format the form data
        const fd = form.data;
        const result = {
            fileName: fd['export-file-name'],
            ext: fd['select-ext-type'],
            // For some reason, checkbox data is formatted as an array
            // When the checkbox is not checked, the array is empty: []
            // When the checkbox is checked, the array has one empty string element in it: [""]
            separateChapters: fd['separate-chapter'].length > 0,
            titleChapters: fd['title-chapters'].length > 0,
            combineFragmentsOn: fd['combine-fragments-on'] === '' ? null : fd['combine-fragments-on'],
            skipChapterTitleFirst: fd["skip-first"]?.length > 0, 
            skipChapterTitleLast: fd["skip-last" ]?.length > 0,
            addIndents: fd["add-indents"]?.length > 0,
        };

        // Put spinner back up 
        formContainer.innerHTML = `<div class="loader"></div>`;

        // Post the submission to the export webview
        acquireVsCodeApi().postMessage({ 
            type: 'submit', 
            exportInfo: result,
        });
    });
}());