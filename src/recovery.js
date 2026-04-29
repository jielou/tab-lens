// URL-keyed recovery pool used to preserve openedAt/lastVisitedAt/visitCount
// across browser restarts when chrome.tabs.query() may return stale or empty
// results before session restore completes.

function buildRecoveryPool(oldTimestamps) {
  const pool = {};
  if (!oldTimestamps) return pool;
  for (const entry of Object.values(oldTimestamps)) {
    if (!entry || !entry.url) continue;
    if (!pool[entry.url]) pool[entry.url] = [];
    pool[entry.url].push({
      openedAt: entry.openedAt,
      lastVisitedAt: entry.lastVisitedAt,
      visitCount: entry.visitCount || 0,
    });
  }
  for (const url of Object.keys(pool)) {
    pool[url].sort((a, b) => (a.openedAt || Infinity) - (b.openedAt || Infinity));
  }
  return pool;
}

function consumeRecovery(pool, url) {
  if (!pool || !url) return null;
  const bucket = pool[url];
  if (!bucket || bucket.length === 0) return null;
  const entry = bucket.shift();
  if (bucket.length === 0) delete pool[url];
  return entry;
}

if (typeof module !== 'undefined') {
  module.exports = { buildRecoveryPool, consumeRecovery };
}
