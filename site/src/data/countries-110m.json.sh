#!/bin/sh
# Natural Earth 1:110m country polygons (public domain) via the world-atlas npm package (ISC).
set -e
cat node_modules/world-atlas/countries-110m.json
