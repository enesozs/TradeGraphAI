# Shortcuts. The app is the React + Vite app in app/ (the legacy Observable site in site/ is reference only).
.PHONY: dev build data test lint install

install:          ## install app dependencies
	cd app && npm install

dev:              ## run the app at http://localhost:5173 (copies the pipeline marts first)
	cd app && npm run dev

build:            ## static production build into app/dist
	cd app && npm run build

data:             ## rebuild every mart from the raw snapshot (takes a few minutes)
	unset VIRTUAL_ENV; uv run tradegraph all

test:             ## pipeline tests, lint and format check
	unset VIRTUAL_ENV; uv run pytest && uv run ruff check . && uv run ruff format --check .

lint:             ## app type check and lint
	cd app && npx tsc --noEmit -p tsconfig.app.json && npx oxlint src
