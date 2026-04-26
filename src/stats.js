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

function todayActivity(tabs, closedLog, openedLog) {
  const now = Date.now();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const opened = (openedLog || []).filter(e => e.ts >= dayStart.getTime()).length;
  const closed = (closedLog || []).filter(e => e.ts >= dayStart.getTime()).length;
  return { opened, closed, netGrowth: opened - closed };
}

function findDuplicateTabs(tabs) {
  const seen = new Map();
  const duplicates = [];
  for (const tab of tabs) {
    const url = tab.url;
    if (!url) continue;
    if (seen.has(url)) {
      duplicates.push(tab);
    } else {
      seen.set(url, tab.id);
    }
  }
  return { count: duplicates.length, duplicates };
}

function longestUntouched(tabs) {
  const withTs = tabs.filter(t => t.lastVisitedAt !== null && t.lastVisitedAt !== undefined);
  if (withTs.length === 0) return null;
  return withTs.reduce((oldest, tab) => tab.lastVisitedAt < oldest.lastVisitedAt ? tab : oldest);
}

function topDistractors(tabs, limit = 5) {
  return [...tabs]
    .filter(t => (t.visitCount || 0) > 0)
    .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))
    .slice(0, limit);
}

function topStaleTabs(tabs, limit = 5) {
  return staleTabs(tabs)
    .sort((a, b) => {
      const aTs = a.lastVisitedAt || 0;
      const bTs = b.lastVisitedAt || 0;
      return aTs - bTs;
    })
    .slice(0, limit);
}

function tabTrend14Days(snapshots, currentCount) {
  const days = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    d.setHours(0, 0, 0, 0);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const count = snapshots && snapshots[key] !== undefined ? snapshots[key] : 0;
    days.push({ label, count });
  }
  return days;
}

function openTabsPerDay(tabs, closedLog, numDays = 14) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const currentCount = tabs.length;
  const days = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const dayEnd = now - i * DAY_MS;
    const openedAfter = tabs.filter(t => t.openedAt && t.openedAt > dayEnd).length;
    const closedAfter = closedLog.filter(e => e.ts && e.ts > dayEnd).length;
    const estimate = Math.max(0, currentCount - openedAfter + closedAfter);
    const date = new Date(dayEnd);
    const label = i === 0 ? 'Today'
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    days.push({ label, count: estimate, isToday: i === 0 });
  }
  return days;
}

if (typeof module !== 'undefined') {
  module.exports = { topDomains, windowStats, focusScore, topDistractor, oldestSurvivor, domainObsession, closedPerDay, staleTabs, openTabsPerDay };
}
