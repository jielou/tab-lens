let _statsDomain;
if (typeof require !== 'undefined') {
  _statsDomain = require('./tabData').extractDomain;
} else {
  _statsDomain = extractDomain; // global from tabData.js
}

function topDomains(tabs) {
  const counts = new Map();
  for (const tab of tabs) {
    const d = _statsDomain(tab.url);
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
    const d = _statsDomain(tab.url);
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

function staleTabs(tabs, now = Date.now()) {
  const THREE_HOURS = 3 * 60 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;
  return tabs.filter(t => {
    if (!t.openedAt || now - t.openedAt < ONE_HOUR) return false;
    if (t.lastVisitedAt && now - t.lastVisitedAt < THREE_HOURS) return false;
    return true;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { topDomains, windowStats, focusScore, topDistractor, oldestSurvivor, domainObsession, closedPerDay, staleTabs };
}
