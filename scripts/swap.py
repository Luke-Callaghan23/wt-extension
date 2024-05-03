import os
import subprocess


if \
    os.path.isfile(".web/bufferSource.ts") and \
    os.path.isfile(".web/fetchSource.ts") and \
    os.path.isfile(".web/extension.ts") and \
    os.path.isfile(".web/package-lock.json") and \
    os.path.isfile(".web/package.json") and \
    os.path.isfile(".web/.vscode/extensions.json") and \
    os.path.isfile(".web/.vscode/launch.json") and \
    os.path.isfile(".web/.vscode/settings.json") and \
    os.path.isfile(".web/.vscode/tasks.json") and \
    os.path.isfile(".web/web/test/suite/extension.test.ts") and \
    os.path.isfile(".web/web/test/suite/index.ts") and \
    os.path.isfile(".web/tsconfig.json") and \
    os.path.isfile(".web/gitTransactions.ts") and \
    os.path.isfile(".web/workspaceClass.ts"):

    os.makedirs(name=".local", exist_ok=True)
    os.rename("src/Buffer/bufferSource.ts", ".local/bufferSource.ts")
    os.rename("src/Fetch/fetchSource.ts", ".local/fetchSource.ts")
    os.rename("src/extension.ts", ".local/extension.ts")
    os.rename("package-lock.json", ".local/package-lock.json")
    os.rename("package.json", ".local/package.json")
    os.rename(".vscode", ".local/.vscode")
    os.rename("tsconfig.json", ".local/tsconfig.json")
    os.rename("src/export", ".local/export")
    os.rename("src/import", ".local/import")
    os.rename("src/workspace/importExport", ".local/importExport")
    os.rename("src/gitTransactions.ts", ".local/gitTransactions.ts")
    os.rename("src/workspace/workspaceClass.ts", ".local/workspaceClass.ts")
    os.rename("src/ttsDebugger", ".local/ttsDebugger")

    os.rename(".web/bufferSource.ts", "src/Buffer/bufferSource.ts")
    os.rename(".web/fetchSource.ts", "src/Fetch/fetchSource.ts")
    os.rename(".web/extension.ts", "src/extension.ts")
    os.rename(".web/package-lock.json", "package-lock.json")
    os.rename(".web/package.json", "package.json")
    os.rename(".web/.vscode", ".vscode")
    os.rename(".web/web", "src/web")
    os.rename(".web/tsconfig.json", "tsconfig.json")
    os.rename(".web/gitTransactions.ts", "src/gitTransactions.ts")
    os.rename(".web/workspaceClass.ts", "src/workspace/workspaceClass.ts")

    subprocess.run(["powershell.exe", "npm", "clean-install"], shell=True)

elif \
    os.path.isfile(".local/bufferSource.ts") and \
    os.path.isfile(".local/fetchSource.ts") and \
    os.path.isfile(".local/extension.ts") and \
    os.path.isfile(".local/package-lock.json") and \
    os.path.isfile(".local/package.json") and \
    os.path.isfile(".local/.vscode/extensions.json") and \
    os.path.isfile(".local/.vscode/launch.json") and \
    os.path.isfile(".local/.vscode/settings.json") and \
    os.path.isfile(".local/.vscode/tasks.json") and \
    os.path.isfile(".local/tsconfig.json") and \
    os.path.isfile(".local/export/exportDocuments.ts") and \
    os.path.isfile(".local/export/exportFormView.ts") and \
    os.path.isfile(".local/import/importDropProvider.ts") and \
    os.path.isfile(".local/import/importFiles.ts") and \
    os.path.isfile(".local/import/importFileSystemView.ts") and \
    os.path.isfile(".local/import/importFormView.ts") and \
    os.path.isfile(".local/importExport/types.ts") and \
    os.path.isfile(".local/importExport/exportWorkspace.ts") and \
    os.path.isfile(".local/importExport/importWorkspace.ts") and \
    os.path.isfile(".local/gitTransactions.ts") and \
    os.path.isfile(".local/ttsDebugger/debugger/activateTTSDebug.ts") and \
    os.path.isfile(".local/ttsDebugger/debugger/debugAdapter.ts") and \
    os.path.isfile(".local/ttsDebugger/debugger/debugExtention.ts") and \
    os.path.isfile(".local/ttsDebugger/debugger/ttsDebug.ts") and \
    os.path.isfile(".local/ttsDebugger/debugger/ttsRuntime.ts") and \
    os.path.isfile(".local/ttsDebugger/debugSession.ts") and \
    os.path.isfile(".local/ttsDebugger/tts/tts.ts") and \
    os.path.isfile(".local/ttsDebugger/tts/windows.ts") and \
    os.path.isfile(".local/ttsDebugger/tts/windowsCommand.ts") and \
    os.path.isfile(".local/workspaceClass.ts"):

    os.makedirs(name=".web", exist_ok=True)
    os.rename("src/Buffer/bufferSource.ts", ".web/bufferSource.ts")
    os.rename("src/Fetch/fetchSource.ts", ".web/fetchSource.ts")
    os.rename("src/extension.ts", ".web/extension.ts")
    os.rename("package-lock.json", ".web/package-lock.json")
    os.rename("package.json", ".web/package.json")
    os.rename(".vscode", ".web/.vscode")
    os.rename("src/web", ".web/web")
    os.rename("tsconfig.json", ".web/tsconfig.json")
    os.rename("src/gitTransactions.ts", ".web/gitTransactions.ts")
    os.rename("src/workspace/workspaceClass.ts", ".web/workspaceClass.ts ")

    os.rename(".local/ttsDebugger", "src/ttsDebugger")
    os.rename(".local/bufferSource.ts", "src/Buffer/bufferSource.ts")
    os.rename(".local/fetchSource.ts", "src/Fetch/fetchSource.ts")
    os.rename(".local/extension.ts", "src/extension.ts")
    os.rename(".local/package-lock.json", "package-lock.json")
    os.rename(".local/package.json", "package.json")
    os.rename(".local/.vscode", ".vscode")
    os.rename(".local/tsconfig.json", "tsconfig.json")
    os.rename(".local/export", "src/export")
    os.rename(".local/import", "src/import")
    os.rename(".local/importExport", "src/workspace/importExport")
    os.rename(".local/gitTransactions.ts", "src/gitTransactions.ts")
    os.rename(".local/workspaceClass.ts", "src/workspace/workspaceClass.ts")

    subprocess.run(["powershell.exe", "npm", "clean-install"], shell=True)

else:
    print(".local or .web broken :(")
