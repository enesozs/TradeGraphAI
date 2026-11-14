#!/bin/sh
# Data loader: serves the pipeline mart (run `uv run tradegraph scenarios` first).
set -e
cat ../data/marts/HS12_V202601/scenario_summary.parquet
