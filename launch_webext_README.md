1. Make sure you have a cert for vscode.dev installed at `$HOME/certs`
  * Review instructions for this here
2. Run `./scripts/swap.sh` or `python3 ./scripts/swap.py` or `. ./scripts/swap.ps1`
3. Run `npx serve --cors -l 5000 --ssl-cert $HOME/certs/localhost.pem --ssl-key $HOME/certs/localhost-key.pem`
4. Open `vscode.dev` in a browser
5. Open command palette in `vscode.dev` and run `Developer: Install Extension from Location...`
6. Paste `https://localhost:5000/` into the prompt
7. WTANIWE Web should install in `vscode.dev`