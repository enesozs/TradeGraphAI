# TradeGraph AI app

The browser app: React, Vite, Tailwind CSS, [coss](https://coss.com/ui) components, deck.gl maps, Observable Plot charts, and DuckDB-WASM querying the Parquet files in `public/data`. There is no backend.

```bash
npm ci
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm run lint
```

`npm run dev` and `npm run build` first run `npm run data`. It copies the files the app reads from the pipeline's marts (`../data/marts/<release>`) into `public/data`. Without a local pipeline build it keeps the committed copy.

See the [project README](../README.md) for the data, the pipeline and deployment.
