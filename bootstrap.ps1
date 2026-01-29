$env:ELECTRON_OVERRIDE_DIST_PATH="/dev/null"
$env:ELECTRON_SKIP_BINARY_DOWNLOAD=1
$env:npm_config_python="C:\ProgramData\miniconda3\python.exe"

$compassPath = Join-Path -Path $PSScriptRoot -ChildPath "compass"

Set-Location $compassPath

npm ci --ignore-scripts

node_modules\.bin\lerna run bootstrap --stream `
    --ignore @mongodb-js/mongodb-compass `
    --ignore @mongodb-js/testing-library-compass `
    --ignore compass-e2e-tests `
    --ignore @mongodb-js/compass-smoke-tests `
    --ignore @mongodb-js/compass-test-server `
    --ignore @mongodb-js/compass-web

Copy-Item `
    -Path (Join-Path -Path $compassPath -ChildPath "packages\compass-import-export\dist") `
    -Destination (Join-Path -Path $PSScriptRoot -ChildPath "compass-import-export") `
    -Recurse

Set-Location $PSScriptRoot