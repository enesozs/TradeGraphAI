#!/bin/sh
# Data loader: serves the pipeline mart (run `uv run tradegraph all` first).
set -e
cat ../data/marts/HS12_V202601/movers_supplier.parquet
