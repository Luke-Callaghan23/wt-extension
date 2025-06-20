/* eslint-disable curly */
// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();

    let documents = [];
    
    
    const importFileTypes = [
        'wt',
        'txt',
        'docx',
        'html',
        'odt', 
        'md'
    ];

    const formContainer = document.getElementById('form-container');
    formContainer.innerHTML = `<div class="loader"></div>`;

    function loadDocuments (documents, chapterUris, droppedSource) {

        const allDocInfo = {};
        
        const docs = [];
        documents.forEach(({ name, fullPath, ext }) => {
            allDocInfo[fullPath] = {
                skip: false,
                
                ext: ext.replace('.', ''),
                
                // By default the imported data will be a new work snip with the name 'Imported Snip'
                // If a dropped source was provided (as in the source of this import was a user dropping an importable file into the 'chapters' or 'snips' folder)
                //      then we use that destination as default instead
                outputType: droppedSource ? droppedSource.destination : 'snip',
                
                outputIntoChapter: false,
                outputSnipPath: '/data/snips/',
                outputSnipName: `${name} (Imported)`,

                outputChapterName: `${name} (Imported)`,
                useNonGenericFragmentNames: true,

                outputIntoDroppedSource: !!droppedSource,
                
                shouldSplitFragments: false,
                outerSplitRegex: '\\[{3,}?([^\\]]*)\\]{3,}?',
                shouldSplitSnips: false,
                fragmentSplitRegex: '~{3,}?([^~]*)~{3,}?',
            };
            if (chapterUris.length !== 0) {
                allDocInfo[fullPath].outputChapterName = `${name} (Imported)`;
                allDocInfo[fullPath].outputChapter = chapterUris[0][0];
            }
            docs.push(`<vscode-option value="${fullPath}">${name} (${fullPath})</vscode-option>`);
        });

        formContainer.innerHTML = `
            <div class="head">Import Content</div>
            <vscode-form-container id="log-settings-form">
                <vscode-label for="select-file-name" class="label">Content File Name:</vscode-label>
                <vscode-form-helper>
                    <p>The targeted document.</p>
                </vscode-form-helper>
                <vscode-single-select id="select-file-name" name="select-file-name" class="select select-file-name">
                    ${docs.join('')}
                </vscode-single-select>
                <div class="spacer"></div>
                <div id="target"></div>
                <div id="preview" style="display: none;">
                    <div class="loader"></div>
                </div>
                <div class="spacer"></div>
                <vscode-label class="label">Import:</vscode-label>
                <div class="log-settings-row">
                    <vscode-button id="prev-button">Previous Import</vscode-button>
                    &nbsp;&nbsp;&nbsp;
                    <vscode-button id="preview-button">Preview</vscode-button>
                    &nbsp;&nbsp;&nbsp;
                    <vscode-button id="import-button">Import All Files</vscode-button>
                    &nbsp;&nbsp;&nbsp;
                    <vscode-button id="next-button">Next Import</vscode-button>
                </div>
            </vscode-form-container>
        `;

        let skipElement = document.getElementById("checkbox-skip");
        let extElement = document.getElementById("select-ext-type");
        let outputTypeElement = document.getElementById("select-output-type");
        let useDroppedSourceElement = document.getElementById("checkbox-use-dropped-location");
        let useNonGenericFragmentNamesElement = document.getElementById("checkbox-non-generic-fragment-names");
        let outputIntoChapterElement = document.getElementById("checkbox-output-into-chapter");
        let outputChapterElement = document.getElementById("select-chapter");
        let outputChapterNameElement = document.getElementById("input-output-chapter-name");
        let outputSnipNameElement = document.getElementById("input-output-snip-name");
        let shouldSplitFragmentsElement = document.getElementById("checkbox-split-document");
        let fragmentSplitRegexElement = document.getElementById("input-fragment-split");
        let shouldSplitSnipsElement = document.getElementById("checkbox-split-snips");
        let outerSplitRegexElement = document.getElementById("input-outer-split");

        function saveDocumentInfoState (savedDocPath) {
            // All ids of all inputs


            const docInfo = allDocInfo[savedDocPath];

            // Reset the document info wherever there is a valid .value property on a valid element
            // Otherwise, retain the old value that exists in the doc info struct
            docInfo.ext = extElement?.value || docInfo.ext;
            docInfo.outputType = outputTypeElement?.value || docInfo.outputType;
            docInfo.outputChapter = outputChapterElement?.value || docInfo.outputChapter;
            docInfo.outputChapterName = outputChapterNameElement?.value || docInfo.outputChapterName;
            docInfo.outputSnipName = outputSnipNameElement?.value || docInfo.outputSnipName;
            docInfo.fragmentSplitRegex = fragmentSplitRegexElement?.value || docInfo.fragmentSplitRegex;
            docInfo.outerSplitRegex = outerSplitRegexElement?.value || docInfo.outerSplitRegex;

            // Checkboxes need a little more probing
            if (skipElement?.ariaChecked !== undefined && skipElement?.ariaChecked !== null) {
                docInfo.skip = skipElement?.ariaChecked === 'true';
            }
            if (useDroppedSourceElement?.ariaChecked !== undefined && useDroppedSourceElement?.ariaChecked !== null) {
                docInfo.outputIntoDroppedSource = useDroppedSourceElement?.ariaChecked === 'true';
            }
            if (outputIntoChapterElement?.ariaChecked !== undefined && outputIntoChapterElement?.ariaChecked !== null) {
                docInfo.outputIntoChapter = outputIntoChapterElement?.ariaChecked === 'true';
            }
            if (useNonGenericFragmentNamesElement?.ariaChecked !== undefined && useNonGenericFragmentNamesElement?.ariaChecked !== null) {
                docInfo.useNonGenericFragmentNames = useNonGenericFragmentNamesElement?.ariaChecked === 'true';
            }
            if (shouldSplitFragmentsElement?.ariaChecked !== undefined && shouldSplitFragmentsElement?.ariaChecked !== null) {
                docInfo.shouldSplitFragments = shouldSplitFragmentsElement?.ariaChecked === 'true';
            }
            if (shouldSplitSnipsElement?.ariaChecked !== undefined && shouldSplitSnipsElement?.ariaChecked !== null) {
                docInfo.shouldSplitSnips = shouldSplitSnipsElement?.ariaChecked === 'true';
            }
        }

        const previewContainer = document.getElementById('preview')
        const docInfoContainer = document.getElementById('target');
        function displayDocumentInfo (selectedDocPath) {
            
            const docInfo = allDocInfo[selectedDocPath];

            // Create a string for the extension type of the import document select
            const extSelectOptions = importFileTypes.map(ext => {
                if (ext === docInfo.ext) {
                    return `<vscode-option selected value="${ext}">${ext}</vscode-option>`;
                }
                return `<vscode-option value="${ext}">${ext}</vscode-option>`;
            }).join('');

            // Create a string for the select of output type
            const outputTypeOptions = [ ['chapter', 'Chapter'], ['snip', 'Snip'] ].map(([type, display]) => {
                if (type === docInfo.outputType) {
                    return `<vscode-option value=${type} selected>${display}</vscode-option>`;
                }
                return `<vscode-option value=${type}>${display}</vscode-option>`;
            }).join('');

            // Create a string for the select of chapter output destination
            let chapterSelectString = '';
            if (docInfo.outputIntoChapter) {
                chapterSelectString = chapterUris.map(([ uri, chapterName ]) => {
                    if (docInfo.outputChapter === uri) {
                        return `<vscode-option selected value="${uri}">${chapterName}</vscode-option>`;
                    }
                    return `<vscode-option value="${uri}">${chapterName}</vscode-option>`;
                }).join('');
            }

            docInfoContainer.innerHTML = `

                <vscode-label for="checkbox-skip" class="label">Skip?</vscode-label>
                <vscode-checkbox 
                    label="Indicates that you want to skip the import of this chapter."
                    id="checkbox-skip" 
                    name="skip" 
                    class="checkbox"
                    ${docInfo.skip && 'checked'}
                ></vscode-checkbox>

                ${
                    !docInfo.skip 
                        ? `<vscode-label for="select-ext-type" class="label">File Type:</vscode-label>
                        <vscode-form-helper>
                            <p>The file type format that the file importer will use to interpret this file.</p>
                        </vscode-form-helper>
                        <vscode-single-select 
                            id="select-ext-type" 
                            name="select-ext-type" 
                            class="select select-ext-type"
                        >
                            ${extSelectOptions}
                        </vscode-single-select>
        
                        <div class="spacer"></div>
						<div id="odt-warning" style="${ docInfo.ext !== 'odt' ? 'display: none;' : ''}">
							<vscode-label id="error-label" class="label error-label">
								To import from odt format, you will need libreoffice installed on your machine.  Otherwise we cannot make the conversion from files to .odt to .wt fragments.<br/>
								Also, ODT files take vastly more time to import than any other kind of document.  You might want to convert the ODT to MS Word and then import that.
							</vscode-label>
						</div>

                        ${
                            droppedSource 
                                ? `<vscode-label for="checkbox-use-dropped-location" class="label">Import into same folder?</vscode-label>
                                    <vscode-checkbox 
                                        label="Indicates you want the contents of the imported document to go into the same location you dropped your ${docInfo.ext} file (${droppedSource.namePath} (hint: you probably want this))"
                                        id="checkbox-use-dropped-location" 
                                        name="into-dropped-location" 
                                        class="checkbox"
                                        ${docInfo.outputIntoDroppedSource && 'checked'}
                                    ></vscode-checkbox>`
                                : ''
                        }
                        
                        ${
                            !droppedSource || !docInfo.outputIntoDroppedSource 
                                ? `<vscode-label for="select-output-type" class="label">Output Type:</vscode-label>
                                    <vscode-form-helper>
                                        <p>The main resource type that this import will create</p>
                                    </vscode-form-helper>
                                    <vscode-single-select 
                                        id="select-output-type" 
                                        name="filter" 
                                        class="select select-output-type"
                                    >
                                        ${outputTypeOptions}
                                    </vscode-single-select>
                                    
                                    <div class="spacer"></div>

                                    <vscode-label for="checkbox-non-generic-fragment-names" class="label">Use Non-Generic Fragment Names?</vscode-label>
                                    <vscode-checkbox 
                                        label="Indicates that you want any generic fragment names to inherit any non-generic snip names in this document."
                                        id="checkbox-non-generic-fragment-names" 
                                        name="non-generic-fragment-names" 
                                        class="checkbox"
                                        ${docInfo.useNonGenericFragmentNames && 'checked'}
                                    ></vscode-checkbox>

                                    <div class="spacer"></div>
                    
                                    ${
                                        docInfo.outputType !== 'chapter' && chapterUris.length > 0
                                            ? `
                                                <vscode-label for="checkbox-output-into-chapter" class="label">Output into Chapter?</vscode-label>
                                                <vscode-checkbox 
                                                    label="Indicates that you want to export the contents of this file into an existing chapter."
                                                    id="checkbox-output-into-chapter" 
                                                    name="output-into-chapter" 
                                                    class="checkbox"
                                                    ${docInfo.outputIntoChapter && 'checked'}
                                                ></vscode-checkbox>`
                                            : ''
                                    }
                    
                                    ${
                                        docInfo.outputIntoChapter 
                                            ? `
                                                <vscode-label for="select-chapter" class="label">Output Chapter:</vscode-label>
                                                <vscode-form-helper>
                                                    <p>Chapter that the importer will insert the new snip(s) into.</p>
                                                </vscode-form-helper>
                                                <vscode-single-select 
                                                    id="select-chapter" 
                                                    name="filter" 
                                                    class="select select-chapter"
                                                >
                                                    ${chapterSelectString}
                                                </vscode-single-select>
                                                <div class="spacer"></div>
                                            `
                                            : 
                                                docInfo.outputType === 'chapter' 
                                                    ? `
                                                        <vscode-label for="output-name" class="label">New Chapter Name:</vscode-label>
                                                        <vscode-form-helper>
                                                            <p>Name of the new chapter to be created.</p>
                                                        </vscode-form-helper>
                                                        <vscode-textfield 
                                                            value="${docInfo.outputChapterName}" 
                                                            id="input-output-chapter-name" 
                                                            name="tail" 
                                                            class="input input-tail"
                                                        ></vscode-textfield>
                                                    `
                                                    :  `
                                                        <vscode-label for="output-name" class="label">New Snip Name:</vscode-label>
                                                        <vscode-form-helper>
                                                            <p>Name of the new imported snip.  If you choose to separate the imported document into multiple snips, then the new snip names will follow the pattern of '[name] (0)', '[name] (1)', etc.  For example 'Imported Snip (0)', 'Imported Snip (1)'.</p>
                                                        </vscode-form-helper>
                                                        <vscode-textfield 
                                                            value="${docInfo.outputSnipName}" 
                                                            id="input-output-snip-name" 
                                                            name="tail" 
                                                            class="input input-tail"
                                                        ></vscode-textfield>
                                                    `
                                    }`
                                : ''
                        }
                        
                        
                        <div class="spacer"></div>
        
                        <vscode-label for="checkbox-split-document" class="label">Split the document?</vscode-label>
                        <vscode-checkbox 
                            label="Indicates that you would like to split the document up into separate snips/fragments"
                            id="checkbox-split-document" 
                            name="split-document" 
                            class="checkbox"
                            ${docInfo.shouldSplitFragments && 'checked'}
                        ></vscode-checkbox>
        
                        
                        ${
                            docInfo.shouldSplitFragments 
                                ? `
                                    <vscode-label for="input-fragment-split" class="label">Fragment Separator:</vscode-label>
                                    <vscode-form-helper>
                                    <p>Regex used to split the text in this document into separate snips. By default, I use the pattern '~{3,}' which is three or more tildes '~' in a row.  <a href="https://regex101.com/r/YJp24E/1">Learn more about fragment separator regexes (and how to title your fragments!)</a></p>
                                    </vscode-form-helper>
                                    <vscode-textfield 
                                        value="${docInfo.fragmentSplitRegex}" 
                                        id="input-fragment-split" 
                                        name="tail" 
                                        class="input input-tail"
                                    ></vscode-textfield>
                                    <div class="spacer"></div>
                                    <vscode-label for="checkbox-split-snips" class="label">Split on ${docInfo.outputType}s?</vscode-label>
                                    <vscode-checkbox 
                                        id="checkbox-split-snips" 
                                        name="split-snips" 
                                        class="checkbox"
                                        label="Indicates that you would like to use the following separator to split the document into separate ${docInfo.outputType}s"
                                        ${docInfo.shouldSplitSnips && 'checked'}
                                    ></vscode-checkbox>`
                                : ''
                        }
        
                        ${
        
                            docInfo.shouldSplitSnips 
                                ? docInfo.outputType !== 'chapter'
                                    ? `
                                        <div class="spacer"></div>
                                        <vscode-label for="input-outer-split" class="label">Snip Separator:</vscode-label>
                                        <vscode-form-helper>
                                            <p>Regex used to split the text in this document into separate snips. By default, I use the pattern '\\[{3,}([^\\]]*)\\]{3,}' which separates the text document on lines where there are three or more opening brackets '[', followed by three or more closing brackets ']'.  It also includes an capture group '([\\]]]*)' which allows to match any text within the bracket pairs where the user can specify a title for the snip.  <a href="https://regex101.com/r/JWiBei/1">Learn more about snip separator regexes (and how to title your snips!)</a></p>
                                        </vscode-form-helper>
                                        <vscode-textfield 
                                            value="${docInfo.outerSplitRegex}" 
                                            id="input-outer-split" 
                                            name="tail" 
                                            class="input input-tail"
                                        ></vscode-textfield>`
                                    : `
                                        <div class="spacer"></div>
                                        <vscode-label for="input-outer-split" class="label">Chapter Separator:</vscode-label>
                                        <vscode-form-helper>
                                            <p>Regex used to split the text in this document into separate chapters. By default, I use the pattern '\\[{3,}\\]{3,}' which separates the text document on lines where there are three or more opening brackets '[', followed by three or more closing brackets ']'.  <a href="https://regex101.com/r/JWiBei/1">Learn more about chapter separator regexes (and how to title your chapters!)</a></p>
                                        </vscode-form-helper>
                                        <vscode-textfield 
                                            value="${docInfo.outerSplitRegex}" 
                                            id="input-outer-split" 
                                            name="tail" 
                                            class="input input-tail"
                                        ></vscode-textfield>`
                                : ''
                        }`
                    : ''
                }
            `;

            // Reset all the data source elements
            extElement = document.getElementById("select-ext-type");
            useDroppedSourceElement = document.getElementById("checkbox-use-dropped-location");
            outputTypeElement = document.getElementById("select-output-type");
            outputChapterElement = document.getElementById("select-chapter");
            outputChapterNameElement = document.getElementById("input-output-chapter-name");
            outputSnipNameElement = document.getElementById("input-output-snip-name");
            fragmentSplitRegexElement = document.getElementById("input-fragment-split");
            outerSplitRegexElement = document.getElementById("input-outer-split");

            skipElement = document.getElementById("checkbox-skip");
            useNonGenericFragmentNamesElement = document.getElementById("checkbox-non-generic-fragment-names");
            outputIntoChapterElement = document.getElementById("checkbox-output-into-chapter");
            shouldSplitFragmentsElement = document.getElementById("checkbox-split-document");
            shouldSplitSnipsElement = document.getElementById("checkbox-split-snips");

            // Attach event handlers to redraw the document whenever a checkbox is hit
            // Checkboxes indicate new sections of html being added/removed, so the document
            //      must update to reflect those changes
            [ 
                skipElement, 
                useNonGenericFragmentNamesElement,
                outputIntoChapterElement, 
                shouldSplitFragmentsElement, 
                shouldSplitSnipsElement,
                useDroppedSourceElement
            ].forEach(element => {
                try {
                    element.addEventListener('click', () => {
                        saveDocumentInfoState(currentDoc);
                        displayDocumentInfo(currentDoc);
                    });
                }
                catch (e) {}
            });

            [
                extElement,
                outputTypeElement,
                outputChapterElement,
                outputChapterNameElement,
                outputSnipNameElement,
                fragmentSplitRegexElement,
                outerSplitRegexElement,
            ].forEach(element => {
                try {
                    element.addEventListener('change', () => {
                        saveDocumentInfoState(currentDoc);
                        displayDocumentInfo(currentDoc);
                    });
                }
                catch (e) {}
            });

            // Attach event handler to other fields that need to redraw the screen whenever
            //      their value is updated
            [ [outputTypeElement, 'outputType'] ].forEach(([ element, field ]) => {
                try {
                    element.addEventListener('click', (event) => {
                        const newType = event.target.value;
                        if (allDocInfo[currentDoc][field] === newType) return;
                        saveDocumentInfoState(currentDoc);
                        displayDocumentInfo(currentDoc);
                    });
                }
                catch (e) {}
            });
            
            setTimeout(() => {
                preview.click();
            }, 100);
        }
        let currentDoc = documents[0].fullPath;
        displayDocumentInfo(currentDoc);
        
        // File selecor
        const fileDropDown = document.getElementById('select-file-name');

        function changeDoc (newDoc) {
            saveDocumentInfoState(currentDoc);
            displayDocumentInfo(newDoc);
            currentDoc = newDoc;
            fileDropDown.value = currentDoc;
        }

        // Event listener for switching the displayed options whenever the user selects a new 
        //      document to import
        document.getElementById('select-file-name').addEventListener('click', (event) => {
            const newDoc = event.target.value;
            if (currentDoc === newDoc) return;
            changeDoc(newDoc);
        });

        // Next and previous button event listeners
        document.getElementById('next-button').addEventListener('click', () => {
            const currentIndex = documents.findIndex(doc => doc.fullPath === currentDoc);
            const newIndex = currentIndex !== documents.length - 1 ? currentIndex + 1 : 0;
            const newDoc = documents[newIndex].fullPath;
            changeDoc(newDoc);
        });

        document.getElementById('prev-button').addEventListener('click', () => {
            const currentIndex = documents.findIndex(doc => doc.fullPath === currentDoc);
            const newIndex = currentIndex !== 0 ? currentIndex - 1 : documents.length - 1;
            const newDoc = documents[newIndex].fullPath;
            changeDoc(newDoc);
        });

        
        const odtWarningMessage = document.getElementById("odt-warning");
        const extTypeBox = document.getElementById("select-ext-type");
        extTypeBox.addEventListener("click", (e) => {
            if (e.target.value === 'odt') {
                odtWarningMessage.style.display = '';
                return;
            }
            odtWarningMessage.style.display = 'none';
        });


        const preview = document.getElementById('preview-button');
        preview.addEventListener('click', async (event) => {
            event.preventDefault;

            previewContainer.style.display = '';

            saveDocumentInfoState(currentDoc);
            vscode.postMessage({ 
                type: 'preview', 
                docName: currentDoc,
                singleDoc: allDocInfo[currentDoc]
            });

            const preview = await new Promise((resolve) => {
                const listener = event => {
                    const message = event.data; // The json data that the extension sent
                    if (message.type === 'preview') {
                        window.removeEventListener('message', listener);
                        resolve(message.preview);
                        return;
                    }
                }

                window.addEventListener('message', listener);
            });

            const processSummaryText = (text) => {
                const cutoff = 400;
                if (text.length > cutoff) {
                    const prepend = text.substring(0, cutoff / 2);
                    const append = text.substring(text.length - cutoff / 2, text.length);
                    text = `${prepend}...${append}`
                }
                return text;
            }

            const liToString = (li) => {
                return `<details ${li.children.length === 0 ? 'class="collapsible"' : 'open'}>
                    <summary ${li.children.length === 0 ? 'class="collapsible"' : ''}>${processSummaryText(li.name)}</summary>
                    <ul style="list-style-type: none;">
                    ${(li.children.map(child => {
                        return `<li>${liToString(child)}</li>`
                    })).join('')}
                    </ul>
                </details>`;
            };

            previewContainer.innerHTML = `
                <div style="margin-top: 30px"></div>
                <hr />
                <h2>Preview:</h2>
                    ${liToString(preview)}
                <hr />
                <div class="spacer"></div>
            `;
        })

        const submit = document.getElementById('import-button');
        submit.addEventListener('click', (event) => {
            event.preventDefault();

            // Put spinner back up 
            formContainer.innerHTML = `<div class="loader"></div>`;

            // Post the submission to the import webview
            saveDocumentInfoState(currentDoc);
            vscode.postMessage({ 
                type: 'submit', 
                docInfo: allDocInfo
            });
        });
    }


    // Message handling
    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'sentDocuments':
                loadDocuments(message.documents, message.chapterUris, message.droppedSource);
                break;
        }
    });

    // Once the page is loaded, request documents from the main vscode instance
    vscode.postMessage({
        type: 'requestDocuments'
    });
}());