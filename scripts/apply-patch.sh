#!/bin/bash

set -e

latest_patch=$(ls patches | sort -n | tail -1)

cd compass && git apply ../patches/$latest_patch