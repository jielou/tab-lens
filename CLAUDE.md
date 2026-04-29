# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm test           # run all Jest tests
```

To run a single test file:
```bash
npx jest --config config/jest.config.js tests/stats.test.js
```

After editing source files, reload the extension at `chrome://extensions/` by clicking the refresh icon on the TabLens card.

## Architecture

TabLens is a **Manifest V3 Chrome Extension** with no framework dependencies.

### Data flow

`background.js` (service worker) → `chrome.storage.local` → `manager.js` (dashboard UI)

The background worker listens to Chrome tab events (`onCreated`, `onActivated`, `onUpdated`, `onRemoved`) and persists all tab metadata. The dashboard reads that storage on load to render analytics.

### Storage schema

All data lives in `chrome.storage.local` under these keys:

| Key | Shape | Description |
|---|---|---|
| `timestamps` | `{ [tabId]: { openedAt, lastVisitedAt, visitCount, url } }` | Per-tab metadata; rebuilt on startup since Chrome recycles tab IDs |
| `openedLog` | `[{ ts, domain }]` | Rolling 5-day log of tab opens, used for net growth |
| `closedLog` | `[{ ts, domain }]` | Rolling 5-day log of tab closes |
| `dailySnapshots` | `{ 'YYYY-MM-DD': count }` | Daily tab count snapshots, 14-day window, updated by `dailySnapshot` alarm |

### Write queue

`background.js` serializes all storage writes through a promise chain (`enqueue(fn)`) to prevent race conditions between concurrent tab events.

### Shared module pattern

`tabData.js`, `stats.js`, and `grouping.js` use a dual-export pattern so they work in both the browser and Jest (Node):

```js
if (typeof module !== 'undefined') {
  module.exports = { ... };   // Jest / Node
} else {
  window.foo = foo;           // browser global
}
```

`stats.js` and `grouping.js` import from `tabData.js` via `require()` in Node or rely on its `window.*` globals in the browser.

### Tab classification (stats.js)

- **Stale**: open ≥ 1h, untouched ≥ 24h (`findStaleTabs`) — zombie detection uses 3h untouched threshold (`staleTabs`)
- **Distracted**: `visitCount >= 10`
- **Temporary**: matches search/redirect/blank URL patterns
- **Duplicate**: exact URL match

### Smart grouping (grouping.js)

Two-pass clustering: domain-first (tabs sharing a domain), then keyword-based (title/URL keyword overlap) for unclaimed tabs. Only ungrouped tabs (`groupId === -1`) are eligible.

### Testing

Tests live in `tests/`. Jest uses `jest-webextension-mock` to provide `chrome.*` APIs. The test environment is `node` (not `jsdom`), so browser APIs beyond the mock are unavailable.
