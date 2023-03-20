if 
    test -f .web/bufferSource.ts && 
    test -f .web/extension.ts &&
    test -f .web/bufferSource.ts &&
    test -f .web/package-lock.json &&
    test -f .web/package.json &&
    test -f .web/.vscode/extensions.json &&
    test -f .web/.vscode/launch.json &&
    test -f .web/.vscode/settings.json &&
    test -f .web/.vscode/tasks.json && 
    test -f .web/web/test/suite/extension.test.ts &&
    test -f .web/web/test/suite/index.ts;
then
    echo "Hello"
#     mv package.json package.json.local
#     mv package.json.web package.json
#     mv package-lock.json package-lock.json.local
#     mv package-lock.json.web package-lock.json
#     npm clean-install
elif 
    test -f .local/bufferSource.ts && 
    test -f .local/extension.ts &&
    test -f .local/bufferSource.ts &&
    test -f .local/package-lock.json &&
    test -f .local/package.json &&
    test -f .local/.vscode/extensions.json &&
    test -f .local/.vscode/launch.json &&
    test -f .local/.vscode/settings.json &&
    test -f .local/.vscode/tasks.json;
then
    echo "bye"
#     mv package.json package.json.web
#     mv package.json.local package.json
#     mv package-lock.json package-lock.json.web
#     mv package-lock.json.local package-lock.json
#     npm clean-install
else 
    echo ".local or .web broken :("
fi