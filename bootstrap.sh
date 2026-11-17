#!/bin/bash

set -e

export ELECTRON_OVERRIDE_DIST_PATH="/dev/null"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

cd compass

# Re-apply compass-web adaptations on top of the official Compass checkout.
for patch in ../patches/*.patch; do
  if [ ! -f "$patch" ]; then
    continue
  fi
  if git apply --check "$patch" 2>/dev/null; then
    git apply "$patch"
  elif git apply --check --reverse "$patch" 2>/dev/null; then
    echo "Already applied: $patch"
  else
    echo "Failed to apply $patch" >&2
    exit 1
  fi
done

npm ci --ignore-scripts

node_modules/.bin/lerna run bootstrap --stream \
    --ignore @mongodb-js/mongodb-compass \
    --ignore @mongodb-js/testing-library-compass \
    --ignore compass-e2e-tests \
    --ignore @mongodb-js/compass-smoke-tests \
    --ignore @mongodb-js/compass-test-server \
    --ignore @mongodb-js/compass-web \
    --ignore @mongodb-js/compass-shell

cp -r ./packages/compass-import-export/dist/ ../compass-import-export