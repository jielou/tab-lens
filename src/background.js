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

function isInternalUrl(url) {
  if (!url) return false;
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('edge://') ||
         url.startsWith('about:') ||
         url.startsWith('devtools://');
}

function formatLocalDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getTimestamps() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

async function setTimestamps(timestamps) {
  await chrome.storage.local.set({ [STORAGE_KEY]: timestamps });
}

async function updateDailySnapshot() {
  try {
    const tabs = await chrome.tabs.query({});
    const visibleTabs = tabs.filter(t => !isInternalUrl(t.url));
    const now = Date.now();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const key = formatLocalDate(dayStart);
    const result = await chrome.storage.local.get('dailySnapshots');
    const snapshots = result.dailySnapshots || {};
    snapshots[key] = visibleTabs.length;
    // Prune entries older than 14 days
    const cutoff = new Date(dayStart.getTime() - 14 * 24 * 60 * 60 * 1000);
    const cutoffKey = formatLocalDate(cutoff);
    for (const k of Object.keys(snapshots)) {
      if (k < cutoffKey) delete snapshots[k];
    }
    await chrome.storage.local.set({ dailySnapshots: snapshots });
  } catch (err) {
    console.error('[tab-manager] snapshot failed:', err);
  }
}

// On startup, reinitialize timestamps because Chrome recycles tab IDs.
chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    const tabs = await chrome.tabs.query({});
    const visibleTabs = tabs.filter(t => !isInternalUrl(t.url));
    const oldTimestamps = await getTimestamps();

    // Build recoverable old entries (include old ID so we can mark used)
    const oldEntries = Object.entries(oldTimestamps).map(([id, data]) => ({
      id,
      ...data,
      used: false,
    }));

    const timestamps = {};
    for (const tab of visibleTabs) {
      const url = tab.url || '';
      // Find an unused old record with the exact same URL, prefer oldest openedAt
      const match = oldEntries
        .filter(e => !e.used && e.url === url)
        .sort((a, b) => (a.openedAt || Infinity) - (b.openedAt || Infinity))[0];

      if (match) {
        match.used = true;
        timestamps[tab.id] = {
          openedAt: match.openedAt,
          lastVisitedAt: match.lastVisitedAt,
          visitCount: match.visitCount || 0,
          url,
        };
      } else {
        const now = Date.now();
        timestamps[tab.id] = { openedAt: now, lastVisitedAt: now, visitCount: 0, url };
      }
    }

    await setTimestamps(timestamps);
    await updateDailySnapshot();
    chrome.alarms.create('dailySnapshot', { periodInMinutes: 1440 });
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  enqueue(async () => {
    // Fresh start: clear all old tracking data (only on first install, not on update)
    await chrome.storage.local.remove(['timestamps', 'openedLog', 'closedLog', 'dailySnapshots']);

    const tabs = await chrome.tabs.query({});
    const visibleTabs = tabs.filter(t => t.url && !isInternalUrl(t.url));
    const timestamps = {};
    const openedLog = [];
    const now = Date.now();
    for (const tab of visibleTabs) {
      timestamps[tab.id] = { openedAt: null, lastVisitedAt: null, visitCount: 0, url: tab.url };
      openedLog.push({ ts: now, domain: extractDomain(tab.url) });
    }
    await setTimestamps(timestamps);
    await chrome.storage.local.set({ openedLog });
    await updateDailySnapshot();
    chrome.alarms.create('dailySnapshot', { periodInMinutes: 1440 });
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.url || isInternalUrl(tab.url)) return;
  enqueue(async () => {
    const timestamps = await getTimestamps();
    timestamps[tab.id] = { openedAt: Date.now(), lastVisitedAt: Date.now(), visitCount: 0, url: tab.url };
    await setTimestamps(timestamps);
    await updateDailySnapshot();

    // Record open log for net growth stats (survives tab ID resets)
    const domain = extractDomain(tab.url || '');
    const result = await chrome.storage.local.get('openedLog');
    const log = result.openedLog || [];
    const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const pruned = log.filter(e => e.ts > cutoff);
    pruned.push({ ts: Date.now(), domain });
    await chrome.storage.local.set({ openedLog: pruned });
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(async () => {
    const tab = await chrome.tabs.get(tabId);
    if (isInternalUrl(tab.url)) return;
    const timestamps = await getTimestamps();
    if (!timestamps[tabId]) {
      const now = Date.now();
      timestamps[tabId] = { openedAt: now, lastVisitedAt: now, visitCount: 1, url: tab.url || '' };
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
    if (isInternalUrl(changeInfo.url)) {
      if (timestamps[tabId]) {
        delete timestamps[tabId];
        await setTimestamps(timestamps);
      }
      return;
    }
    if (timestamps[tabId]) {
      timestamps[tabId].url = changeInfo.url;
    } else {
      const now = Date.now();
      timestamps[tabId] = { openedAt: now, lastVisitedAt: now, visitCount: 0, url: changeInfo.url };
    }
    await setTimestamps(timestamps);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const timestamps = await getTimestamps();
    const tabData = timestamps[tabId] || {};
    delete timestamps[tabId];
    await setTimestamps(timestamps);

    if (isInternalUrl(tabData.url)) return;

    const domain = extractDomain(tabData.url || '');
    const result = await chrome.storage.local.get('closedLog');
    const log = result.closedLog || [];
    const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const pruned = log.filter(e => e.ts > cutoff);
    pruned.push({ ts: Date.now(), domain });
    await chrome.storage.local.set({ closedLog: pruned });
    await updateDailySnapshot();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailySnapshot') {
    enqueue(() => updateDailySnapshot());
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/manager.html') });
});
