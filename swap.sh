if 
    test -f .web/bufferSource.ts && 
    test -f .web/fetchSource.ts && 
    test -f .web/extension.ts &&
    test -f .web/package-lock.json &&
    test -f .web/package.json &&
    test -f .web/.vscode/extensions.json &&
    test -f .web/.vscode/launch.json &&
    test -f .web/.vscode/settings.json &&
    test -f .web/.vscode/tasks.json && 
    test -f .web/web/test/suite/extension.test.ts &&
    test -f .web/web/test/suite/index.ts &&
    test -f .web/tsconfig.json &&
    test -f .web/gitTransactions.ts &&
    test -f .web/workspaceClass.ts;
then
    mv src/Buffer/bufferSource.ts .local/bufferSource.ts
    mv src/Fetch/fetchSource.ts .local/fetchSource.ts
    mv src/extension.ts .local/extension.ts
    mv package-lock.json .local/package-lock.json
    mv package.json .local/package.json
    mv .vscode .local/.vscode
    mv tsconfig.json .local/tsconfig.json
    mv src/export .local/export
    mv src/import .local/import
    mv src/workspace/importExport .local/importExport
    mv src/gitTransactions.ts .local/gitTransactions.ts
    mv src/workspace/workspaceClass.ts .local/workspaceClass.ts
    mv src/ttsDebugger .local/ttsDebugger

    mv .web/bufferSource.ts src/Buffer/bufferSource.ts
    mv .web/fetchSource.ts src/Fetch/fetchSource.ts
    mv .web/extension.ts src/extension.ts
    mv .web/package-lock.json package-lock.json
    mv .web/package.json package.json
    mv .web/.vscode .vscode
    mv .web/web src/web
    mv .web/tsconfig.json tsconfig.json
    mv .web/gitTransactions.ts src/gitTransactions.ts
    mv .web/workspaceClass.ts src/workspace/workspaceClass.ts

    npm clean-install
elif 
    test -f .local/bufferSource.ts && 
    test -f .local/fetchSource.ts && 
    test -f .local/extension.ts &&
    test -f .local/package-lock.json &&
    test -f .local/package.json &&
    test -f .local/.vscode/extensions.json &&
    test -f .local/.vscode/launch.json &&
    test -f .local/.vscode/settings.json &&
    test -f .local/.vscode/tasks.json &&
    test -f .local/tsconfig.json && 
    test -f .local/export/exportDocuments.ts &&
    test -f .local/export/exportFormView.ts &&
    test -f .local/import/importDropProvider.ts &&
    test -f .local/import/importFiles.ts &&
    test -f .local/import/importFileSystemView.ts &&
    test -f .local/import/importFormView.ts &&
    test -f .local/importExport/types.ts &&
    test -f .local/importExport/exportWorkspace.ts &&
    test -f .local/importExport/importWorkspace.ts &&
    test -f .local/gitTransactions.ts &&
    test -f .local/ttsDebugger/debugger/activateTTSDebug.ts && 
    test -f .local/ttsDebugger/debugger/debugAdapter.ts
    test -f .local/ttsDebugger/debugger/debugExtention.ts
    test -f .local/ttsDebugger/debugger/ttsDebug.ts
    test -f .local/ttsDebugger/debugger/ttsRuntime.ts
    test -f .local/ttsDebugger/debugger/web-extension.ts
    test -f .local/ttsDebugger/debugSession.ts
    test -f .local/ttsDebugger/tts/tts.ts
    test -f .local/ttsDebugger/tts/windows.ts
    test -f .local/ttsDebugger/tts/windowsCommand.ts
    test -f .local/workspaceClass.ts;
then
    mv src/Buffer/bufferSource.ts .web/bufferSource.ts
    mv src/Fetch/fetchSource.ts .web/fetchSource.ts
    mv src/extension.ts .web/extension.ts
    mv package-lock.json .web/package-lock.json
    mv package.json .web/package.json
    mv .vscode .web/.vscode
    mv src/web .web/web
    mv tsconfig.json .web/tsconfig.json
    mv src/gitTransactions.ts .web/gitTransactions.ts
    mv src/workspace/workspaceClass.ts .web/workspaceClass.ts 

    mv .local/ttsDebugger src/ttsDebugger
    mv .local/bufferSource.ts src/Buffer/bufferSource.ts
    mv .local/fetchSource.ts src/Fetch/fetchSource.ts
    mv .local/extension.ts src/extension.ts
    mv .local/package-lock.json package-lock.json
    mv .local/package.json package.json
    mv .local/.vscode .vscode
    mv .local/tsconfig.json tsconfig.json
    mv .local/export src/export
    mv .local/import src/import
    mv .local/importExport src/workspace/importExport
    mv .local/gitTransactions.ts src/gitTransactions.ts
    mv .local/workspaceClass.ts src/workspace/workspaceClass.ts

    npm clean-install
else 
    echo ".local or .web broken :("
fi