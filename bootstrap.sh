#!/bin/bash

set -e

export ELECTRON_OVERRIDE_DIST_PATH="/dev/null"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

cd compass

npm ci

node_modules/.bin/lerna run bootstrap --stream \
    --ignore @mongodb-js/mongodb-compass \
    --ignore @mongodb-js/testing-library-compass \
    --ignore compass-e2e-tests \
    --ignore @mongodb-js/compass-smoke-tests \
    --ignore @mongodb-js/compass-test-server \
    --ignore @mongodb-js/compass-web

# Avoid multiple react versions
rm -rf node_modules/react node_modules/react-dom