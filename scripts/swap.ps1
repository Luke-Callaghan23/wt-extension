if (
    (Test-Path .web\bufferSource.ts) -and
    (Test-Path .web\fetchSource.ts) -and
    (Test-Path .web\extension.ts) -and
    (Test-Path .web\package-lock.json) -and
    (Test-Path .web\package.json) -and
    (Test-Path .web\.vscode\extensions.json) -and
    (Test-Path .web\.vscode\launch.json) -and
    (Test-Path .web\.vscode\settings.json) -and
    (Test-Path .web\.vscode\tasks.json) -and
    (Test-Path .web\web\test\suite\extension.test.ts) -and
    (Test-Path .web\web\test\suite\index.ts) -and
    (Test-Path .web\tsconfig.json) -and
    (Test-Path .web\gitTransactions.ts) -and
    (Test-Path .web\tabLabels.ts) -and
    (Test-Path .web\workspaceClass.ts)
) {
    New-Item -ItemType Directory -Path ".local" -ErrorAction SilentlyContinue
    Move-Item src\Buffer\bufferSource.ts .local\bufferSource.ts
    Move-Item src\Fetch\fetchSource.ts .local\fetchSource.ts
    Move-Item src\extension.ts .local\extension.ts
    Move-Item package-lock.json .local\package-lock.json
    Move-Item package.json .local\package.json
    Move-Item .vscode .local\.vscode
    Move-Item tsconfig.json .local\tsconfig.json
    Move-Item src\export .local\export
    Move-Item src\import .local\import
    Move-Item src\workspace\importExport .local\importExport
    Move-Item src\gitFunctionality\gitTransactions.ts .local\gitTransactions.ts
    Move-Item src\workspace\workspaceClass.ts .local\workspaceClass.ts
    Move-Item src\ttsDebugger .local\ttsDebugger
    Move-Item src\tabLabels\tabLabels.ts .local\tabLabels.ts

    Move-Item .web\bufferSource.ts src\Buffer\bufferSource.ts
    Move-Item .web\fetchSource.ts src\Fetch\fetchSource.ts
    Move-Item .web\extension.ts src\extension.ts
    Move-Item .web\package-lock.json package-lock.json
    Move-Item .web\package.json package.json
    Move-Item .web\.vscode .vscode
    Move-Item .web\web src\web
    Move-Item .web\tsconfig.json tsconfig.json
    Move-Item .web\gitTransactions.ts src\gitFunctionality\gitTransactions.ts
    Move-Item .web\workspaceClass.ts src\workspace\workspaceClass.ts
    Move-Item .web\tabLabels.ts src\tabLabels\tabLabels.ts

    npm clean-install
}
elseif (
    (Test-Path .local\bufferSource.ts) -and
    (Test-Path .local\fetchSource.ts) -and
    (Test-Path .local\extension.ts) -and
    (Test-Path .local\package-lock.json) -and
    (Test-Path .local\package.json) -and
    (Test-Path .local\.vscode\extensions.json) -and
    (Test-Path .local\.vscode\launch.json) -and
    (Test-Path .local\.vscode\settings.json) -and
    (Test-Path .local\.vscode\tasks.json) -and
    (Test-Path .local\tsconfig.json) -and
    (Test-Path .local\export\exportDocuments.ts) -and
    (Test-Path .local\export\exportFormView.ts) -and
    (Test-Path .local\import\importDropProvider.ts) -and
    (Test-Path .local\import\importFiles.ts) -and
    (Test-Path .local\import\importFileSystemView.ts) -and
    (Test-Path .local\import\importFormView.ts) -and
    (Test-Path .local\importExport\types.ts) -and
    (Test-Path .local\importExport\exportWorkspace.ts) -and
    (Test-Path .local\importExport\importWorkspace.ts) -and
    (Test-Path .local\gitTransactions.ts) -and
    (Test-Path .local\ttsDebugger\debugger\activateTTSDebug.ts) -and
    (Test-Path .local\ttsDebugger\debugger\debugAdapter.ts) -and
    (Test-Path .local\ttsDebugger\debugger\debugExtention.ts) -and
    (Test-Path .local\ttsDebugger\debugger\ttsDebug.ts) -and
    (Test-Path .local\ttsDebugger\debugger\ttsRuntime.ts) -and
    (Test-Path .local\ttsDebugger\debugSession.ts) -and
    (Test-Path .local\ttsDebugger\tts\tts.ts) -and
    (Test-Path .local\ttsDebugger\tts\windows.ts) -and
    (Test-Path .local\ttsDebugger\tts\windowsCommand.ts) -and
    (Test-Path .local\tabLabels.ts) -and
    (Test-Path .local\workspaceClass.ts)
) {
    New-Item -ItemType Directory -Path ".web" -ErrorAction SilentlyContinue
    Move-Item src\Buffer\bufferSource.ts .web\bufferSource.ts
    Move-Item src\Fetch\fetchSource.ts .web\fetchSource.ts
    Move-Item src\extension.ts .web\extension.ts
    Move-Item package-lock.json .web\package-lock.json
    Move-Item package.json .web\package.json
    Move-Item .vscode .web\.vscode
    Move-Item src\web .web\web
    Move-Item tsconfig.json .web\tsconfig.json
    Move-Item src\gitFunctionality\gitTransactions.ts .web\gitTransactions.ts
    Move-Item src\workspace\workspaceClass.ts .web\workspaceClass.ts 
    Move-Item src\tabLabels\tabLabels.ts .web\tabLabels.ts

    Move-Item .local\ttsDebugger src\ttsDebugger
    Move-Item .local\bufferSource.ts src\Buffer\bufferSource.ts
    Move-Item .local\fetchSource.ts src\Fetch\fetchSource.ts
    Move-Item .local\extension.ts src\extension.ts
    Move-Item .local\package-lock.json package-lock.json
    Move-Item .local\package.json package.json
    Move-Item .local\.vscode .vscode
    Move-Item .local\tsconfig.json tsconfig.json
    Move-Item .local\export src\export
    Move-Item .local\import src\import
    Move-Item .local\importExport src\workspace\importExport
    Move-Item .local\gitTransactions.ts src\gitFunctionality\gitTransactions.ts
    Move-Item .local\workspaceClass.ts src\workspace\workspaceClass.ts
    Move-Item .local\tabLabels.ts src\tabLabels\tabLabels.ts

    npm clean-install
}
else {
    Write-Host ".local or .web broken :("
}