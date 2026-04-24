# Tab Manager v2 — Stats & Grid View Design

**Date:** 2026-04-24

## Overview

Adds a dedicated Stats view with rich analytics and a grid/list toggle to the Tab Manager view. The single-page manager gains a nav bar to switch between two views. A new `stats.js` pure module handles all calculations. The background worker gains visit-count tracking and a rolling closed-tab log.

---

## Architecture

### New and changed files

| File | Change |
|---|---|
| `background.js` | Add `visitCount` increment on `onActivated`; add closed-tab log written on `onRemoved`, pruned to 5 days |
| `stats.js` | New pure module — all analytics calculations, same pattern as `grouping.js` |
| `manager.html` | Add nav bar (`Stats` / `Tab Manager`), two view containers |
| `manager.js` | Add nav switching, stats view renderer, grid/list toggle |
| `manager.css` | Nav bar styles, stats card styles, grid layout |
| `tests/stats.test.js` | Unit tests for `stats.js` pure functions |

### stats.js exports

One pure function per metric — all accept `tabs` (array of merged tab objects with timestamps) plus `closedLog` where needed:

- `topDomains(tabs)` — top 5 domains by tab count
- `windowStats(tabs)` — window count, avg tabs per window
- `focusScore(tabs)` — ratio of visited tabs to total open tabs
- `topDistractor(tabs)` — tab with highest `visitCount` still open
- `oldestSurvivor(tabs)` — tab with oldest `openedAt`
- `domainObsession(tabs)` — domain with highest total `visitCount` across its open tabs
- `closedPerDay(closedLog)` — per-day close counts for last 5 days

---

## Data Model

`chrome.storage.local` schema additions:

```
// existing (unchanged)
{ "tab-{id}": { openedAt, lastVisitedAt } }

// new fields added to existing tab entries
{ "tab-{id}": { openedAt, lastVisitedAt, visitCount } }

// new top-level key
{ "closedLog": [ { ts: <epoch ms>, domain: <string> }, ... ] }
```

`closedLog` is a rolling array. On every `onRemoved` event the background worker appends the new entry then drops any entry older than 5 days before writing back.

---

## Nav Bar

Single `manager.html` page with a nav bar at the top. Two sections (`#stats-view`, `#tab-manager-view`) — active section visible, inactive hidden via CSS `display: none`. Nav state is ephemeral (resets to Stats view on open).

---

## Stats View

Four card groups rendered in `#stats-view`:

### Overview
Current summary bar metrics, moved here:
- Total tabs, number of windows, oldest tab age, longest-running window, suggested groups count

### Domain & Window breakdown
- Top 5 domains: ranked list with tab count (`github.com — 14 tabs`)
- Window stats: number of windows, average tabs per window

### Closed tabs — last 5 days
Per-day close count as a single row: `Mon 12 · Tue 8 · Wed 5 · Thu 14 · Fri 9`
Days with zero closures show `—`.

### Fun insights
- **Focus score**: percentage of open tabs the user has actually visited (low % = tab hoarder)
- **Top distractor**: favicon + title of the tab with highest `visitCount` still open
- **Oldest survivor**: favicon + title of the longest-lived open tab with its age ("Open for 4 days")
- **Domain obsession**: domain with highest total `visitCount` across all its open tabs

---

## Tab Manager View

All tabs shown in one flat list — no window section headers. Chrome tab groups (user-created) are still shown as inline colored group labels since they represent intentional organization.

### List / Grid toggle
- Button in top-right of the Tab Manager view
- Persisted to `localStorage` so it survives page reloads
- Default: list mode

### List mode
Existing row layout: favicon, title, domain, opened/visited ages, close button.

### Grid mode
Card layout, ~4 columns:
- Each card: favicon (larger), title (2-line truncated), domain, "opened X ago", close button
- Full title shown as tooltip on hover

### Suggested Groups panel
Stays on the right in list mode. In grid mode it collapses to a narrow strip on the right — to be finalized during implementation based on what looks least cramped.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Tab has no `visitCount` in storage (pre-update) | Defaults to `0` |
| `closedLog` missing from storage | Treated as empty array |
| Focus score with 0 total tabs | Shows `—` |
| Top distractor / oldest survivor with no data | Card shows "No data yet" |
| Closed log has no entries in a day slot | Shows `—` for that day |
