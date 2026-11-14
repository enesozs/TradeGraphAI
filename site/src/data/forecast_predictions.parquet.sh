#!/bin/sh
# Data loader: serves the pipeline mart (run `uv run tradegraph forecast` first).
set -e
cat ../data/marts/HS12_V202601/forecast_predictions.parquet
