#!/bin/sh
# Data loader: serves the pipeline mart (run `uv run tradegraph comext` first).
set -e
cat ../data/marts/HS12_V202601/comext_importer.parquet
