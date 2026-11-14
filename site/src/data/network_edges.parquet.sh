#!/bin/sh
# Data loader: serves the pipeline mart (run `uv run tradegraph gravity` first).
set -e
cat ../data/marts/HS12_V202601/network_edges.parquet
