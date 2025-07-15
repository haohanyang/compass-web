#!/bin/bash

set -e

export ELECTRON_OVERRIDE_DIST_PATH="/dev/null"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

latest_patch=$(ls patches | sort -n | tail -1)

cd compass

git apply ../patches/$latest_patch

npm ci

node_modules/.bin/lerna run bootstrap --stream \
    --ignore @mongodb-js/mongodb-compass \
    --ignore @mongodb-js/testing-library-compass \
    --ignore compass-e2e-tests \
    --ignore @mongodb-js/compass-smoke-tests \
    --ignore @mongodb-js/compass-test-server \
    --ignore @mongodb-js/compass-web