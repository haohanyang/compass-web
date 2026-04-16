#!/bin/bash

set -e

export ELECTRON_OVERRIDE_DIST_PATH="/dev/null"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

cd compass

npm ci --ignore-scripts

node_modules/.bin/lerna run bootstrap \
    --scope @mongodb-js/webpack-config-compass \
    --scope @mongodb-js/compass-import-export

cp -r ./packages/compass-import-export/dist/ ../compass-import-export