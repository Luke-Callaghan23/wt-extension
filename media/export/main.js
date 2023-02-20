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
            combineFragmentsOn: fd['combine-fragments-on'] === '' ? null : fd['combine-fragments-on']
        };

        // Post the submission to the export webview
        acquireVsCodeApi().postMessage({ 
            type: 'submit', 
            exportInfo: result,
        });
    });
}());