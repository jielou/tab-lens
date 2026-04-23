const STOP_WORDS = new Set(['the','a','an','of','in','on','at','to','for','and','or','is','it','with','this','that']);

function extractDomain(url) {
  if (!url) return '';
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    if (parts.length < 2) return '';
    return parts.slice(-2).join('.');
  } catch {
    return '';
  }
}

function formatAge(timestamp, now = Date.now()) {
  if (timestamp === null || timestamp === undefined) return 'unknown';
  const diffMs = Math.max(0, now - timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function mergeTabsWithTimestamps(tabs, timestamps) {
  return tabs.map(tab => {
    const ts = timestamps[tab.id] || {};
    return {
      ...tab,
      openedAt: ts.openedAt ?? null,
      lastVisitedAt: ts.lastVisitedAt ?? null,
    };
  });
}

if (typeof module !== 'undefined') {
  module.exports = { extractDomain, formatAge, mergeTabsWithTimestamps, STOP_WORDS };
} else if (typeof window !== 'undefined') {
  window.extractDomain = extractDomain;
  window.formatAge = formatAge;
  window.mergeTabsWithTimestamps = mergeTabsWithTimestamps;
  window.STOP_WORDS = STOP_WORDS;
}
