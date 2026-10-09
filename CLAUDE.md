# Fitness Dashboard

Personal desktop dashboard for one user's running and gym training. Electron app, data comes from an Apple Health "Export All Health Data" zip that the user imports by hand. No server, no accounts, no network access except map tiles.

## Commands

Node is installed at `C:\Program Files\nodejs` but may not be on PATH in tool shells. Prefix commands:
PowerShell `$env:Path = 'C:\Program Files\nodejs;' + $env:Path; …`, Bash `export PATH="/c/Program Files/nodejs:$PATH"; …`.

| Command | Purpose |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run build` | Production build into `out/` |
| `npm run typecheck` | `tsc --noEmit` over everything |
| `npm test` | Vitest (`tests/**/*.test.ts`) |
| `npm run import -- "<export.zip>"` | Import an export into `data/fitness.db` without the UI |
| `npm run query -- getOverview 12w` | Call one API method and print JSON |
| `npm run shot -- running shots/running.png [--theme dark] [--out-dir out-x] [--delay 4000]` | Build, render one route in a real window parked off-desktop, save a full-page PNG. Route has no leading slash; `overview` is the start page. Renderer warnings and errors are printed. |

`FD_DB` overrides the database path; `FD_NOW=YYYY-MM-DD` pins "today".

## Layout

```
src/shared/      Code used by both processes: dates, formatting, domain, API contract
  api.ts         The Api interface: every call the renderer can make
  api/<slice>.ts Result types of one page's calls
src/main/        Electron main process
  db.ts          SQLite schema (node:sqlite, built into Electron; no native modules)
  api.ts         createApi(): the one implementation of Api, also used by the CLI
  import/        Apple Health zip -> database
  queries/       One file per page slice; plain functions (db, params) -> data
src/preload/     Exposes window.api
src/renderer/src Renderer: React + Tailwind v4 + ECharts + MapLibre
  pages/         One file per route
  components/    ui.tsx (Card, StatTile, Legend, …), Chart.tsx, MapView.tsx, Sidebar.tsx
  lib/           charts.ts (ECharts option helpers), theme.ts (tokens), useApi.ts, app-state.tsx
  pages/Kit.tsx  Component gallery at #/kit; the reference for how to use the shared pieces
scripts/         CLI entry points
```

A page is a vertical slice: `src/shared/api/<slice>.ts` (types), `src/main/queries/<slice>.ts` (SQL), `src/renderer/src/pages/<Page>.tsx` (UI).

Shared across slices: `WorkoutSummary` (`src/shared/api/common.ts`) is the one shape for a workout in any list; build it in queries with `SUMMARY_COLS` + `toSummary` from `src/main/queries/util.ts` (which also has `all`, `get`, `bounds`, `stream`) and render it with `components/WorkoutTable.tsx`.

## Data rules

- Dates are local `YYYY-MM-DD` strings (`workouts.local_date`); use `src/shared/dates.ts` for all date arithmetic. Weeks start on Monday. Ranges are whole weeks ending with the current one (`rangeBounds`).
- Read workouts through the `workouts_v` view: its `cat` column is the category after the user's manual override. Never read `workouts.category` directly in queries.
- A workout's `title` is what Runna wrote into Health (German). Show it as-is. Untitled workouts get a generated name from sport/category.
- Heart rate, zones and running-form metrics exist only for workouts recorded with an Apple Watch. Older, phone-recorded workouts have nulls; pages must handle missing values without drawing zeros.
- The importer rebuilds all derived tables on every import, so `workouts.id` is not stable across imports; `uid` is.
- Units in the database: metres, seconds, kcal, bpm, watts. Convert at the edge with `src/shared/format.ts`.

## UI rules

- English UI, metric units, pace as min:sec per km.
- Follows the system light/dark setting through CSS variables in `styles.css`. Use the Tailwind colour names (`bg-surface`, `text-ink2`, `border-line`, …) or `useTokens()` for ECharts/MapLibre. No hard-coded hex values in pages.
- The chrome is neutral; colour is reserved for data. Text never takes a series colour: put a `Swatch` beside it.
- Session types keep one colour everywhere (`--cat-*`). Stack and legend order is `RUN_CATEGORIES` / `TRAINING_CATEGORIES` from `src/shared/domain.ts`; that order is what the colour-blind check was run on.
- Charts: build options with `lib/charts.ts`. One y-axis per chart (two measures means two charts side by side). Two or more series need a `Legend`. Every chart has a tooltip and an `ariaLabel`. Bars at most 22px, solid hairline gridlines, 2px lines, no value label on every point.
- One shared date-range control (`PageHeader` renders it) scopes every chart on the page.
- Layout: cards in wrapping flex rows (`flex flex-wrap gap-4`, children `flex-[2] basis-[480px]` / `flex-1 basis-[300px]`) so pages reflow down to a 720px window.
- Big standalone numbers use proportional figures; add the `tnum` class only where numbers align in columns.
