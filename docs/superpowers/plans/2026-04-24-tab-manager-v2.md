# Tab Manager v2 — Stats & Grid View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stats view with rich analytics and a grid/list toggle to the Tab Manager, replacing the summary bar with a dedicated stats page behind a nav bar.

**Architecture:** A new `stats.js` pure module (same pattern as `grouping.js`) computes all analytics. `manager.html` gains a nav bar with two view containers. `manager.js` adds nav switching, stats rendering, grid/list toggle, and a flat tab list. `background.js` gains `visitCount` tracking per tab and a rolling `closedLog` for the past 5 days.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JavaScript (ES2020), HTML/CSS, Jest for unit tests.

---

## File Map

| File | Change |
|---|---|
| `tabData.js` | Add `visitCount` field to `mergeTabsWithTimestamps` output |
| `stats.js` | **New** — pure analytics module: topDomains, windowStats, focusScore, topDistractor, oldestSurvivor, domainObsession, closedPerDay |
| `background.js` | Add inline `extractDomain`, `visitCount` increment on activate, `url` field on create/update, `closedLog` append on remove |
| `manager.html` | Replace summary bar with nav bar; add `#stats-view` and `#tab-manager-view` containers; add `stats.js` script tag |
| `manager.css` | Add nav bar styles, stats card styles, grid card styles; remove summary bar styles |
| `manager.js` | Remove `renderSummaryBar`; add `closedLog` state, nav switching, `renderStatsView`, `renderTabCard`, grid/list toggle; refactor `renderTabList` to flat + grid-aware |
| `tests/tabData.test.js` | Add `visitCount` assertions to `mergeTabsWithTimestamps` tests |
| `tests/stats.test.js` | **New** — unit tests for all `stats.js` exports |

---

## Task 1: Add visitCount to tabData.js (TDD)

**Files:**
- Modify: `tabData.js`
- Test: `tests/tabData.test.js`

- [ ] **Step 1: Write the failing test**

Add these two cases to the `mergeTabsWithTimestamps` describe block in `tests/tabData.test.js`:

```js
  test('includes visitCount from timestamps', () => {
    const tabs = [{ id: 1, title: 'Test', url: 'https://example.com' }];
    const timestamps = { 1: { openedAt: 1000, lastVisitedAt: 2000, visitCount: 5 } };
    const result = mergeTabsWithTimestamps(tabs, timestamps);
    expect(result[0].visitCount).toBe(5);
  });

  test('defaults visitCount to 0 when missing', () => {
    const tabs = [{ id: 2, title: 'Test', url: 'https://example.com' }];
    const timestamps = { 2: { openedAt: 1000, lastVisitedAt: 2000 } };
    const result = mergeTabsWithTimestamps(tabs, timestamps);
    expect(result[0].visitCount).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/tabData.test.js --no-coverage
```

Expected: FAIL — `expect(received).toBe(expected)` — `visitCount` is undefined.

- [ ] **Step 3: Update mergeTabsWithTimestamps in tabData.js**

Replace the function body (lines 28–37):

```js
function mergeTabsWithTimestamps(tabs, timestamps) {
  return tabs.map(tab => {
    const ts = timestamps[tab.id] || {};
    return {
      ...tab,
      openedAt: ts.openedAt ?? null,
      lastVisitedAt: ts.lastVisitedAt ?? null,
      visitCount: ts.visitCount ?? 0,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/tabData.test.js --no-coverage
```

Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add tabData.js tests/tabData.test.js
git commit -m "feat: add visitCount to mergeTabsWithTimestamps"
```

---

## Task 2: Create stats.js + tests (TDD)

**Files:**
- Create: `tests/stats.test.js`
- Create: `stats.js`

- [ ] **Step 1: Write tests/stats.test.js**

```js
const {
  topDomains, windowStats, focusScore, topDistractor,
  oldestSurvivor, domainObsession, closedPerDay,
} = require('../stats');

function makeTab(overrides = {}) {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    windowId: 1,
    openedAt: Date.now() - 1000,
    lastVisitedAt: Date.now(),
    visitCount: 1,
    favIconUrl: '',
    groupId: -1,
    ...overrides,
  };
}

describe('topDomains', () => {
  test('returns domains sorted by tab count', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://github.com/a' }),
      makeTab({ id: 2, url: 'https://github.com/b' }),
      makeTab({ id: 3, url: 'https://github.com/c' }),
      makeTab({ id: 4, url: 'https://google.com/a' }),
      makeTab({ id: 5, url: 'https://google.com/b' }),
      makeTab({ id: 6, url: 'https://reddit.com/a' }),
    ];
    const result = topDomains(tabs);
    expect(result[0]).toEqual({ domain: 'github.com', count: 3 });
    expect(result[1]).toEqual({ domain: 'google.com', count: 2 });
    expect(result[2]).toEqual({ domain: 'reddit.com', count: 1 });
  });

  test('returns at most 5 domains', () => {
    const tabs = ['a','b','c','d','e','f'].map((x, i) =>
      makeTab({ id: i, url: `https://${x}.com/page` })
    );
    expect(topDomains(tabs).length).toBeLessThanOrEqual(5);
  });

  test('skips tabs with no extractable domain', () => {
    const tabs = [
      makeTab({ id: 1, url: '' }),
      makeTab({ id: 2, url: 'https://github.com/a' }),
      makeTab({ id: 3, url: 'https://github.com/b' }),
    ];
    const result = topDomains(tabs);
    expect(result[0].domain).toBe('github.com');
    expect(result).toHaveLength(1);
  });

  test('returns empty array for no tabs', () => {
    expect(topDomains([])).toEqual([]);
  });
});

describe('windowStats', () => {
  test('returns window count and average tabs per window', () => {
    const tabs = [
      makeTab({ id: 1, windowId: 1 }),
      makeTab({ id: 2, windowId: 1 }),
      makeTab({ id: 3, windowId: 2 }),
    ];
    expect(windowStats(tabs)).toEqual({ windowCount: 2, avgTabs: 2 });
  });

  test('returns zeros for empty tabs', () => {
    expect(windowStats([])).toEqual({ windowCount: 0, avgTabs: 0 });
  });

  test('single window', () => {
    const tabs = [makeTab({ id: 1, windowId: 1 }), makeTab({ id: 2, windowId: 1 })];
    expect(windowStats(tabs)).toEqual({ windowCount: 1, avgTabs: 2 });
  });
});

describe('focusScore', () => {
  test('returns percentage of tabs with visitCount > 0', () => {
    const tabs = [
      makeTab({ id: 1, visitCount: 3 }),
      makeTab({ id: 2, visitCount: 0 }),
      makeTab({ id: 3, visitCount: 1 }),
      makeTab({ id: 4, visitCount: 0 }),
    ];
    expect(focusScore(tabs)).toBe(50);
  });

  test('returns null for empty tabs', () => {
    expect(focusScore([])).toBeNull();
  });

  test('returns 100 when all tabs visited', () => {
    const tabs = [makeTab({ id: 1, visitCount: 1 }), makeTab({ id: 2, visitCount: 2 })];
    expect(focusScore(tabs)).toBe(100);
  });

  test('returns 0 when no tabs visited', () => {
    const tabs = [makeTab({ id: 1, visitCount: 0 }), makeTab({ id: 2, visitCount: 0 })];
    expect(focusScore(tabs)).toBe(0);
  });
});

describe('topDistractor', () => {
  test('returns tab with highest visitCount', () => {
    const tabs = [
      makeTab({ id: 1, visitCount: 2 }),
      makeTab({ id: 2, visitCount: 10 }),
      makeTab({ id: 3, visitCount: 5 }),
    ];
    expect(topDistractor(tabs).id).toBe(2);
  });

  test('returns null when all tabs have visitCount 0', () => {
    const tabs = [makeTab({ id: 1, visitCount: 0 }), makeTab({ id: 2, visitCount: 0 })];
    expect(topDistractor(tabs)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(topDistractor([])).toBeNull();
  });
});

describe('oldestSurvivor', () => {
  test('returns tab with oldest openedAt', () => {
    const now = Date.now();
    const tabs = [
      makeTab({ id: 1, openedAt: now - 1000 }),
      makeTab({ id: 2, openedAt: now - 5000 }),
      makeTab({ id: 3, openedAt: now - 2000 }),
    ];
    expect(oldestSurvivor(tabs).id).toBe(2);
  });

  test('ignores tabs with null openedAt', () => {
    const now = Date.now();
    const tabs = [
      makeTab({ id: 1, openedAt: null }),
      makeTab({ id: 2, openedAt: now - 1000 }),
    ];
    expect(oldestSurvivor(tabs).id).toBe(2);
  });

  test('returns null when no tab has openedAt', () => {
    expect(oldestSurvivor([makeTab({ openedAt: null })])).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(oldestSurvivor([])).toBeNull();
  });
});

describe('domainObsession', () => {
  test('returns domain with highest total visitCount', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://github.com/a', visitCount: 5 }),
      makeTab({ id: 2, url: 'https://github.com/b', visitCount: 6 }),
      makeTab({ id: 3, url: 'https://google.com/a', visitCount: 10 }),
    ];
    expect(domainObsession(tabs)).toEqual({ domain: 'github.com', count: 11 });
  });

  test('picks the single highest domain', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://github.com/a', visitCount: 3 }),
      makeTab({ id: 2, url: 'https://google.com/a', visitCount: 10 }),
    ];
    expect(domainObsession(tabs)).toEqual({ domain: 'google.com', count: 10 });
  });

  test('returns null for empty tabs', () => {
    expect(domainObsession([])).toBeNull();
  });
});

describe('closedPerDay', () => {
  test('returns array of 5 day entries', () => {
    expect(closedPerDay([])).toHaveLength(5);
  });

  test('each entry has label and count properties', () => {
    closedPerDay([]).forEach(d => {
      expect(d).toHaveProperty('label');
      expect(d).toHaveProperty('count');
    });
  });

  test('counts entries falling on today (last slot)', () => {
    const now = Date.now();
    const log = [
      { ts: now - 100, domain: 'github.com' },
      { ts: now - 200, domain: 'google.com' },
    ];
    const result = closedPerDay(log);
    expect(result[4].count).toBe(2);
  });

  test('ignores entries older than 5 days', () => {
    const old = Date.now() - 6 * 24 * 60 * 60 * 1000;
    const result = closedPerDay([{ ts: old, domain: 'github.com' }]);
    expect(result.every(d => d.count === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/stats.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../stats'`

- [ ] **Step 3: Create stats.js**

```js
let _extractDomain;
if (typeof require !== 'undefined') {
  _extractDomain = require('./tabData').extractDomain;
} else {
  _extractDomain = extractDomain; // global from tabData.js
}

function topDomains(tabs) {
  const counts = new Map();
  for (const tab of tabs) {
    const d = _extractDomain(tab.url);
    if (!d) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));
}

function windowStats(tabs) {
  const windowIds = new Set(tabs.map(t => t.windowId));
  const windowCount = windowIds.size;
  const avgTabs = windowCount === 0 ? 0 : Math.round(tabs.length / windowCount);
  return { windowCount, avgTabs };
}

function focusScore(tabs) {
  if (tabs.length === 0) return null;
  const visited = tabs.filter(t => (t.visitCount || 0) > 0).length;
  return Math.round((visited / tabs.length) * 100);
}

function topDistractor(tabs) {
  if (tabs.length === 0) return null;
  const sorted = [...tabs].sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
  return sorted[0].visitCount > 0 ? sorted[0] : null;
}

function oldestSurvivor(tabs) {
  const withTs = tabs.filter(t => t.openedAt !== null && t.openedAt !== undefined);
  if (withTs.length === 0) return null;
  return withTs.reduce((oldest, tab) => tab.openedAt < oldest.openedAt ? tab : oldest);
}

function domainObsession(tabs) {
  const totals = new Map();
  for (const tab of tabs) {
    const d = _extractDomain(tab.url);
    if (!d) continue;
    totals.set(d, (totals.get(d) || 0) + (tab.visitCount || 0));
  }
  if (totals.size === 0) return null;
  const [domain, count] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  return { domain, count };
}

function closedPerDay(closedLog) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const days = [];
  for (let i = 4; i >= 0; i--) {
    const dayStart = new Date(now - i * DAY_MS);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = dayStart.getTime() + DAY_MS;
    const label = dayStart.toLocaleDateString('en-US', { weekday: 'short' });
    const count = closedLog.filter(e => e.ts >= dayStart.getTime() && e.ts < dayEnd).length;
    days.push({ label, count });
  }
  return days;
}

if (typeof module !== 'undefined') {
  module.exports = { topDomains, windowStats, focusScore, topDistractor, oldestSurvivor, domainObsession, closedPerDay };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/stats.test.js --no-coverage
```

Expected: PASS — all tests green.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add stats.js tests/stats.test.js
git commit -m "feat: add stats.js pure analytics module with tests"
```

---

## Task 3: Update background.js — visitCount + closedLog

**Files:**
- Modify: `background.js`

No unit tests for Chrome API listeners. Manual verification: load the extension and activate a few tabs, then open the manager and check that `visitCount` values appear non-zero in Stats view.

- [ ] **Step 1: Replace background.js with the updated version**

```js
const STORAGE_KEY = 'timestamps';

let writeQueue = Promise.resolve();

function enqueue(fn) {
  writeQueue = writeQueue.then(fn);
  return writeQueue;
}

function extractDomain(url) {
  if (!url) return '';
  try {
    const parts = new URL(url).hostname.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : '';
  } catch { return ''; }
}

async function getTimestamps() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

async function setTimestamps(timestamps) {
  await chrome.storage.local.set({ [STORAGE_KEY]: timestamps });
}

chrome.runtime.onInstalled.addListener(() => {
  enqueue(async () => {
    const tabs = await chrome.tabs.query({});
    const timestamps = await getTimestamps();
    for (const tab of tabs) {
      if (!timestamps[tab.id]) {
        timestamps[tab.id] = { openedAt: null, lastVisitedAt: null, visitCount: 0, url: tab.url || '' };
      }
    }
    await setTimestamps(timestamps);
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  enqueue(async () => {
    const timestamps = await getTimestamps();
    timestamps[tab.id] = { openedAt: Date.now(), lastVisitedAt: Date.now(), visitCount: 0, url: tab.url || '' };
    await setTimestamps(timestamps);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(async () => {
    const timestamps = await getTimestamps();
    if (!timestamps[tabId]) {
      timestamps[tabId] = { openedAt: null, lastVisitedAt: Date.now(), visitCount: 1, url: '' };
    } else {
      timestamps[tabId].lastVisitedAt = Date.now();
      timestamps[tabId].visitCount = (timestamps[tabId].visitCount || 0) + 1;
    }
    await setTimestamps(timestamps);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  enqueue(async () => {
    const timestamps = await getTimestamps();
    if (timestamps[tabId]) {
      timestamps[tabId].url = changeInfo.url;
      await setTimestamps(timestamps);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const timestamps = await getTimestamps();
    const tabData = timestamps[tabId] || {};
    delete timestamps[tabId];
    await setTimestamps(timestamps);

    const domain = extractDomain(tabData.url || '');
    const result = await chrome.storage.local.get('closedLog');
    const log = result.closedLog || [];
    const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const pruned = log.filter(e => e.ts > cutoff);
    pruned.push({ ts: Date.now(), domain });
    await chrome.storage.local.set({ closedLog: pruned });
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
});
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat: track visitCount per tab and rolling closedLog in background worker"
```

---

## Task 4: Update manager.html — nav bar + view containers

**Files:**
- Modify: `manager.html`

- [ ] **Step 1: Replace manager.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Tab Manager</title>
  <link rel="stylesheet" href="manager.css" />
</head>
<body>
  <nav id="nav-bar">
    <button class="nav-btn active" data-view="stats">Stats</button>
    <button class="nav-btn" data-view="tab-manager">Tab Manager</button>
  </nav>

  <div id="stats-view">
    <div id="stats-content"></div>
  </div>

  <div id="tab-manager-view" class="view-hidden">
    <div id="tab-manager-header">
      <button id="toggle-view-mode">Switch to Grid</button>
    </div>
    <div id="main">
      <div id="tab-list"></div>
      <div id="suggestions-panel">
        <h2>Suggested Groups <button id="toggle-suggestions">▲</button></h2>
        <div id="suggestions-list"></div>
      </div>
    </div>
  </div>

  <div id="toast" class="hidden"></div>
  <script src="tabData.js"></script>
  <script src="grouping.js"></script>
  <script src="stats.js"></script>
  <script src="manager.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add manager.html
git commit -m "feat: add nav bar and two-view layout to manager.html"
```

---

## Task 5: Update manager.css — nav + stats + grid

**Files:**
- Modify: `manager.css`

- [ ] **Step 1: Replace manager.css with the full updated file**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  background: #f5f5f5;
  color: #222;
}

/* ── Nav bar ── */
#nav-bar {
  background: #1a73e8;
  padding: 0 20px;
  display: flex;
  gap: 4px;
  align-items: flex-end;
  height: 48px;
}

.nav-btn {
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  color: rgba(255,255,255,0.7);
  padding: 12px 16px 9px;
  font-size: 14px;
  cursor: pointer;
}

.nav-btn.active { color: white; border-bottom-color: white; }
.nav-btn:hover { color: white; }

/* ── View visibility ── */
.view-hidden { display: none !important; }

/* ── Stats view ── */
#stats-view {
  padding: 20px;
  overflow-y: auto;
  height: calc(100vh - 48px);
}

.stats-section {
  background: white;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.stats-section h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #999;
  margin-bottom: 14px;
}

.stats-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.stat-card {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 14px 18px;
  min-width: 130px;
  text-align: center;
}

.stat-card strong {
  display: block;
  font-size: 22px;
  color: #1a73e8;
  margin-bottom: 4px;
}

.stat-card > span { font-size: 12px; color: #888; }
.stat-card small { display: block; font-size: 11px; color: #aaa; margin-top: 4px; }

.stats-row { display: flex; gap: 32px; }
.stats-col { flex: 1; }
.stats-col h4 { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #555; }
.stats-col p { font-size: 13px; color: #444; margin-bottom: 4px; }

.domain-list { list-style: none; }
.domain-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  font-size: 13px;
  border-bottom: 1px solid #f0f0f0;
}
.domain-list li:last-child { border-bottom: none; }
.domain-name { color: #333; }
.domain-count { color: #888; font-size: 12px; }

.closed-per-day {
  display: flex;
  gap: 20px;
  align-items: flex-end;
}

.day-entry { text-align: center; }
.day-label { display: block; font-size: 11px; color: #aaa; text-transform: uppercase; margin-bottom: 4px; }
.day-count { display: block; font-size: 24px; font-weight: 600; color: #333; }

.insight-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
  font-size: 12px;
  color: #444;
}

.insight-domain { font-size: 16px; font-weight: 600; color: #333; margin: 6px 0; }

/* ── Tab manager view ── */
#tab-manager-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
}

#tab-manager-header {
  display: flex;
  justify-content: flex-end;
  padding: 8px 16px;
  border-bottom: 1px solid #e8e8e8;
  background: white;
  flex-shrink: 0;
}

#toggle-view-mode {
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  color: #555;
}
#toggle-view-mode:hover { background: #f0f4ff; border-color: #1a73e8; color: #1a73e8; }

#main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

#tab-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* ── List mode ── */
.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #555;
  padding: 6px 0 4px;
}

.group-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.tab-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: white;
  border-radius: 6px;
  margin-bottom: 4px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
  cursor: pointer;
}

.tab-row:hover { background: #f0f4ff; }

.tab-favicon { width: 16px; height: 16px; flex-shrink: 0; }

.tab-info { flex: 1; min-width: 0; }

.tab-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-meta {
  font-size: 12px;
  color: #888;
  display: flex;
  gap: 12px;
  margin-top: 2px;
}

.tab-close {
  background: none;
  border: none;
  color: #aaa;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.tab-close:hover { background: #fee; color: #c00; }

/* ── Grid mode ── */
.tab-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.tab-card {
  background: white;
  border-radius: 8px;
  padding: 12px 10px 10px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
  position: relative;
}

.tab-card:hover { background: #f0f4ff; }

.card-favicon { width: 24px; height: 24px; flex-shrink: 0; }

.card-title {
  font-size: 13px;
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
}

.card-domain { font-size: 11px; color: #888; }
.card-age { font-size: 11px; color: #aaa; }

.tab-card .tab-close {
  position: absolute;
  top: 6px;
  right: 4px;
  opacity: 0;
  font-size: 14px;
}

.tab-card:hover .tab-close { opacity: 1; }

/* ── Suggestions panel ── */
#suggestions-panel {
  width: 280px;
  background: white;
  border-left: 1px solid #ddd;
  overflow-y: auto;
  padding: 16px;
  flex-shrink: 0;
}

#suggestions-panel h2 {
  font-size: 14px;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

#toggle-suggestions {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #888;
}

.suggestion-card {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 10px;
}

.suggestion-name { font-weight: 600; margin-bottom: 4px; }
.suggestion-count { font-size: 12px; color: #888; margin-bottom: 6px; }
.suggestion-tabs { font-size: 12px; color: #555; margin-bottom: 8px; }

.suggestion-tab-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.apply-btn {
  background: #1a73e8;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  width: 100%;
}

.apply-btn:hover { background: #1557b0; }

/* ── Toast ── */
#toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: white;
  padding: 12px 20px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 1000;
}

#toast.hidden { display: none; }

#toast-undo {
  background: none;
  border: 1px solid white;
  color: white;
  padding: 2px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

#toast-undo:hover { background: rgba(255,255,255,0.15); }
```

- [ ] **Step 2: Commit**

```bash
git add manager.css
git commit -m "feat: add nav bar, stats cards, and grid layout styles"
```

---

## Task 6: Rewrite manager.js — stats view + nav + grid/list + flat tab list

**Files:**
- Modify: `manager.js`

This task replaces the full `manager.js`. It removes `renderSummaryBar`, adds `closedLog` state, adds `renderStatsView`, refactors `renderTabList` to be flat + grid-aware, and adds nav + toggle logic.

- [ ] **Step 1: Replace manager.js with the updated version**

```js
let allTabs = [];
let timestamps = {};
let closedLog = [];
let suggestions = [];
let pendingUndo = null;
let undoTimer = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadData() {
  allTabs = await chrome.tabs.query({});
  const result = await chrome.storage.local.get(['timestamps', 'closedLog']);
  timestamps = result.timestamps || {};
  closedLog = result.closedLog || [];
  allTabs = mergeTabsWithTimestamps(allTabs, timestamps);
  suggestions = suggestGroups(allTabs);
}

function groupTabsByWindow(tabs) {
  const windows = new Map();
  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) windows.set(tab.windowId, []);
    windows.get(tab.windowId).push(tab);
  }
  return windows;
}

function getWindowOldestTab(tabs) {
  return tabs.reduce((oldest, tab) => {
    if (!oldest) return tab;
    if (!tab.openedAt) return oldest;
    if (!oldest.openedAt) return tab;
    return tab.openedAt < oldest.openedAt ? tab : oldest;
  }, null);
}

function renderStatsView() {
  const tabs = allTabs;
  const domains = topDomains(tabs);
  const winStats = windowStats(tabs);
  const score = focusScore(tabs);
  const distractor = topDistractor(tabs);
  const survivor = oldestSurvivor(tabs);
  const obsession = domainObsession(tabs);
  const perDay = closedPerDay(closedLog);

  const allOpenedAts = tabs.map(t => t.openedAt).filter(Boolean);
  const oldestTimestamp = allOpenedAts.length ? Math.min(...allOpenedAts) : null;

  const windows = groupTabsByWindow(tabs);
  let longestWindowLabel = '';
  let longestWindowAge = 0;
  let winIdx = 1;
  for (const [, winTabs] of windows) {
    const oldest = getWindowOldestTab(winTabs);
    if (oldest?.openedAt) {
      const age = Date.now() - oldest.openedAt;
      if (age > longestWindowAge) {
        longestWindowAge = age;
        longestWindowLabel = `Window ${winIdx}: ${formatAge(oldest.openedAt)}`;
      }
    }
    winIdx++;
  }

  const focusLabel = score === null ? '—'
    : score >= 80 ? 'Great focus!'
    : score >= 50 ? 'Moderate hoarder'
    : 'Tab hoarder alert';

  document.getElementById('stats-content').innerHTML = `
    <div class="stats-section">
      <h3>Overview</h3>
      <div class="stats-cards">
        <div class="stat-card"><strong>${tabs.length}</strong><span>tabs</span></div>
        <div class="stat-card"><strong>${winStats.windowCount}</strong><span>windows</span></div>
        <div class="stat-card"><strong>${escapeHtml(formatAge(oldestTimestamp))}</strong><span>oldest tab</span></div>
        ${longestWindowLabel ? `<div class="stat-card"><strong>${escapeHtml(longestWindowLabel)}</strong><span>longest window</span></div>` : ''}
        <div class="stat-card"><strong>${suggestions.length}</strong><span>suggested groups</span></div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Domain &amp; Window Breakdown</h3>
      <div class="stats-row">
        <div class="stats-col">
          <h4>Top 5 Domains</h4>
          <ul class="domain-list">
            ${domains.length
              ? domains.map(d => `<li><span class="domain-name">${escapeHtml(d.domain)}</span><span class="domain-count">${d.count} tabs</span></li>`).join('')
              : '<li style="color:#aaa">No data</li>'}
          </ul>
        </div>
        <div class="stats-col">
          <h4>Windows</h4>
          <p>${winStats.windowCount} window${winStats.windowCount !== 1 ? 's' : ''}</p>
          <p>avg ${winStats.avgTabs} tab${winStats.avgTabs !== 1 ? 's' : ''} / window</p>
        </div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Closed Tabs — Last 5 Days</h3>
      <div class="closed-per-day">
        ${perDay.map(d => `
          <div class="day-entry">
            <span class="day-label">${escapeHtml(d.label)}</span>
            <span class="day-count">${d.count || '—'}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="stats-section">
      <h3>Fun Insights</h3>
      <div class="stats-cards">
        <div class="stat-card">
          <strong>${score !== null ? score + '%' : '—'}</strong>
          <span>Focus Score</span>
          <small>${escapeHtml(focusLabel)}</small>
        </div>
        <div class="stat-card">
          <strong>Top Distractor</strong>
          ${distractor ? `
            <div class="insight-tab">
              ${distractor.favIconUrl ? `<img src="${escapeHtml(distractor.favIconUrl)}" width="16" height="16" onerror="this.style.display='none'">` : ''}
              <span>${escapeHtml((distractor.title || distractor.url || '').slice(0, 40))}</span>
            </div>
            <small>${distractor.visitCount} visits</small>
          ` : '<span style="color:#aaa;font-size:12px">No data yet</span>'}
        </div>
        <div class="stat-card">
          <strong>Oldest Survivor</strong>
          ${survivor ? `
            <div class="insight-tab">
              ${survivor.favIconUrl ? `<img src="${escapeHtml(survivor.favIconUrl)}" width="16" height="16" onerror="this.style.display='none'">` : ''}
              <span>${escapeHtml((survivor.title || survivor.url || '').slice(0, 40))}</span>
            </div>
            <small>Open for ${formatAge(survivor.openedAt)}</small>
          ` : '<span style="color:#aaa;font-size:12px">No data yet</span>'}
        </div>
        <div class="stat-card">
          <strong>Domain Obsession</strong>
          ${obsession ? `
            <div class="insight-domain">${escapeHtml(obsession.domain)}</div>
            <small>${obsession.count} total visits</small>
          ` : '<span style="color:#aaa;font-size:12px">No data yet</span>'}
        </div>
      </div>
    </div>
  `;
}

function groupTabsByNativeGroup(tabs) {
  const groups = new Map();
  groups.set(-1, []);
  for (const tab of tabs) {
    const gid = tab.groupId ?? -1;
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(tab);
  }
  return groups;
}

const GROUP_COLOR_CSS = {
  blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00',
  green: '#1e8e3e', pink: '#e91e8c', purple: '#7b1fa2',
  cyan: '#00acc1', orange: '#e65100', grey: '#9e9e9e',
};

async function getNativeGroupInfo() {
  try {
    const groups = await chrome.tabGroups.query({});
    const map = {};
    for (const g of groups) map[g.id] = { title: g.title, color: g.color };
    return map;
  } catch {
    return {};
  }
}

async function renderTabList() {
  const container = document.getElementById('tab-list');
  const viewMode = localStorage.getItem('viewMode') || 'list';
  const nativeGroups = await getNativeGroupInfo();
  const byGroup = groupTabsByNativeGroup(allTabs);
  let html = '';

  for (const [groupId, groupTabs] of byGroup) {
    if (groupTabs.length === 0) continue;
    if (groupId !== -1 && nativeGroups[groupId]) {
      const g = nativeGroups[groupId];
      const dotColor = GROUP_COLOR_CSS[g.color] || '#888';
      html += `<div class="group-header">
        <span class="group-color-dot" style="background:${dotColor}"></span>
        ${escapeHtml(g.title || '(unnamed group)')}
      </div>`;
    }
    if (viewMode === 'grid') {
      html += `<div class="tab-grid">`;
      for (const tab of groupTabs) html += renderTabCard(tab);
      html += `</div>`;
    } else {
      for (const tab of groupTabs) html += renderTabRow(tab);
    }
  }

  container.innerHTML = html;
}

function renderTabRow(tab) {
  const title = tab.title || tab.url || '(no title)';
  const domain = extractDomain(tab.url) || tab.url || '';
  const openedAge = formatAge(tab.openedAt);
  const visitedAge = formatAge(tab.lastVisitedAt);
  const favicon = tab.favIconUrl
    ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" onerror="this.style.display='none'">`
    : `<span class="tab-favicon"></span>`;
  return `
    <div class="tab-row" data-tab-id="${tab.id}" data-window-id="${tab.windowId}">
      ${favicon}
      <div class="tab-info">
        <div class="tab-title">${escapeHtml(title)}</div>
        <div class="tab-meta">
          <span>${escapeHtml(domain)}</span>
          <span>opened: ${openedAge}</span>
          <span>visited: ${visitedAge}</span>
        </div>
      </div>
      <button class="tab-close" data-tab-id="${tab.id}" title="Close tab">×</button>
    </div>`;
}

function renderTabCard(tab) {
  const title = tab.title || tab.url || '(no title)';
  const domain = extractDomain(tab.url) || tab.url || '';
  const openedAge = formatAge(tab.openedAt);
  const favicon = tab.favIconUrl
    ? `<img class="card-favicon" src="${escapeHtml(tab.favIconUrl)}" onerror="this.style.display='none'">`
    : `<span class="card-favicon"></span>`;
  return `
    <div class="tab-card" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" title="${escapeHtml(title)}">
      ${favicon}
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="card-domain">${escapeHtml(domain)}</div>
      <div class="card-age">${openedAge}</div>
      <button class="tab-close" data-tab-id="${tab.id}" title="Close tab">×</button>
    </div>`;
}

async function closeTab(tab) {
  if (undoTimer) {
    clearTimeout(undoTimer);
    undoTimer = null;
    pendingUndo = null;
  }

  pendingUndo = {
    url: tab.url,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title || tab.url,
    tabId: tab.id,
  };

  chrome.tabs.remove(tab.id).catch(err =>
    console.error('[tab-manager] remove failed:', err)
  );
  allTabs = allTabs.filter(t => t.id !== tab.id);
  suggestions = suggestGroups(allTabs);
  renderStatsView();
  await renderTabList();
  renderSuggestions();
  showToast(pendingUndo.title);
}

function showToast(title) {
  const toast = document.getElementById('toast');
  const truncated = title.length > 40 ? title.slice(0, 40) + '…' : title;
  toast.innerHTML = `
    <span>"${escapeHtml(truncated)}" closed</span>
    <button id="toast-undo">Undo</button>
  `;
  toast.classList.remove('hidden');

  document.getElementById('toast-undo').addEventListener('click', () => undoClose(), { once: true });

  undoTimer = setTimeout(() => {
    pendingUndo = null;
    undoTimer = null;
    toast.classList.add('hidden');
  }, 5000);
}

async function undoClose() {
  if (!pendingUndo) return;
  const { url, windowId, index } = pendingUndo;
  pendingUndo = null;
  clearTimeout(undoTimer);
  undoTimer = null;
  document.getElementById('toast').classList.add('hidden');
  await chrome.tabs.create({ url, windowId, index });
  await loadData();
  renderStatsView();
  await renderTabList();
  renderSuggestions();
}

function renderSuggestions() {
  const list = document.getElementById('suggestions-list');
  if (suggestions.length === 0) {
    list.innerHTML = '<p style="color:#888;font-size:13px;">No suggestions — all tabs are already grouped or unique.</p>';
    return;
  }

  list.innerHTML = suggestions.map((s, i) => {
    const tabs = s.tabIds.map(id => allTabs.find(t => t.id === id)).filter(Boolean);
    const tabTitles = tabs.slice(0, 3).map(t =>
      `<div class="suggestion-tab-title">${escapeHtml(t.title || t.url)}</div>`
    ).join('');
    const more = tabs.length > 3 ? `<div style="color:#888">+${tabs.length - 3} more</div>` : '';
    return `
      <div class="suggestion-card">
        <div class="suggestion-name">${escapeHtml(s.groupName)}</div>
        <div class="suggestion-count">${tabs.length} tabs</div>
        <div class="suggestion-tabs">${tabTitles}${more}</div>
        <button class="apply-btn" data-suggestion-index="${i}">Apply Group</button>
      </div>`;
  }).join('');

  list.querySelectorAll('.apply-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = parseInt(btn.dataset.suggestionIndex);
      await applyGroup(suggestions[i]);
    });
  });
}

async function applyGroup(suggestion) {
  const { groupName, color, tabIds } = suggestion;
  const validTabIds = [];
  for (const id of tabIds) {
    try {
      await chrome.tabs.get(id);
      validTabIds.push(id);
    } catch { /* tab no longer exists */ }
  }
  if (validTabIds.length < 1) return;
  try {
    const groupId = await chrome.tabs.group({ tabIds: validTabIds });
    await chrome.tabGroups.update(groupId, { title: groupName, color });
  } catch (err) {
    console.error('[tab-manager] applyGroup failed:', err);
  }
  await loadData();
  renderStatsView();
  await renderTabList();
  renderSuggestions();
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.getElementById('stats-view').classList.toggle('view-hidden', view !== 'stats');
      document.getElementById('tab-manager-view').classList.toggle('view-hidden', view !== 'tab-manager');
    });
  });
}

function setupViewModeToggle() {
  const btn = document.getElementById('toggle-view-mode');
  function updateLabel() {
    const mode = localStorage.getItem('viewMode') || 'list';
    btn.textContent = mode === 'list' ? 'Switch to Grid' : 'Switch to List';
  }
  updateLabel();
  btn.addEventListener('click', async () => {
    const current = localStorage.getItem('viewMode') || 'list';
    localStorage.setItem('viewMode', current === 'list' ? 'grid' : 'list');
    updateLabel();
    await renderTabList();
  });
}

document.getElementById('toggle-suggestions').addEventListener('click', () => {
  const list = document.getElementById('suggestions-list');
  const btn = document.getElementById('toggle-suggestions');
  const hidden = list.style.display === 'none';
  list.style.display = hidden ? '' : 'none';
  btn.textContent = hidden ? '▲' : '▼';
});

function setupLiveUpdates() {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (pendingUndo && pendingUndo.tabId === tabId) return;
    try {
      allTabs = allTabs.filter(t => t.id !== tabId);
      suggestions = suggestGroups(allTabs);
      renderStatsView();
      await renderTabList();
      renderSuggestions();
    } catch (err) {
      console.error('[tab-manager] onRemoved render failed:', err);
    }
  });

  chrome.tabs.onCreated.addListener(async () => {
    try {
      await new Promise(r => setTimeout(r, 200));
      await loadData();
      renderStatsView();
      await renderTabList();
      renderSuggestions();
    } catch (err) {
      console.error('[tab-manager] onCreated render failed:', err);
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.favIconUrl || changeInfo.url) {
      try {
        await loadData();
        renderStatsView();
        await renderTabList();
        renderSuggestions();
      } catch (err) {
        console.error('[tab-manager] onUpdated render failed:', err);
      }
    }
  });
}

async function init() {
  const container = document.getElementById('tab-list');
  container.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.tab-close');
    if (closeBtn) {
      e.stopPropagation();
      const tabId = parseInt(closeBtn.dataset.tabId);
      const tab = allTabs.find(t => t.id === tabId);
      if (tab) closeTab(tab);
      return;
    }
    const row = e.target.closest('.tab-row, .tab-card');
    if (row) {
      const tabId = parseInt(row.dataset.tabId);
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(parseInt(row.dataset.windowId), { focused: true });
    }
  });

  await loadData();
  renderStatsView();
  await renderTabList();
  renderSuggestions();
  setupNav();
  setupViewModeToggle();
  setupLiveUpdates();
}

document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add manager.js
git commit -m "feat: stats view, nav bar, grid/list toggle, flat tab list in manager.js"
```

---

## Final verification checklist

After all tasks are committed, load the unpacked extension in Chrome (`chrome://extensions` → Load unpacked → select the project folder) and verify:

- [ ] Opening the manager lands on the Stats view
- [ ] Stats view shows all four sections (Overview, Domain & Window, Closed Tabs, Fun Insights)
- [ ] Clicking "Tab Manager" nav button switches to the tab list (no window headers)
- [ ] Chrome tab groups still appear as colored labels in the flat list
- [ ] "Switch to Grid" toggles to card layout; "Switch to List" toggles back
- [ ] Grid/list preference persists after closing and reopening the manager
- [ ] Closing a tab removes it from the list, updates the Stats view, and shows undo toast
- [ ] Undo restores the closed tab
- [ ] After activating several tabs, Fun Insights shows non-zero visitCount data
