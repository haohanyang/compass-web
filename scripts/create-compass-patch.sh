#!/bin/bash

set -e

cd compass && git diff --no-color > "../patches/$(date +%s).patch"