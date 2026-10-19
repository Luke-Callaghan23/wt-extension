// Webviews load these straight from the extension folder, so they are copied out of node_modules (which is not packaged).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'media', 'vendor');

const files = [
	'node_modules/@vscode/codicons/dist/codicon.css',
	'node_modules/@vscode/codicons/dist/codicon.ttf',
	'node_modules/@vscode-elements/elements/dist/bundled.js',
];

fs.mkdirSync(dest, { recursive: true });
for (const file of files) {
	fs.copyFileSync(path.join(root, file), path.join(dest, path.basename(file)));
}
