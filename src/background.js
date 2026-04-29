importScripts('recovery.js');

const STORAGE_KEY = 'timestamps';
const RECOVERY_POOL_KEY = 'recoveryPool';
const RECOVERY_CLEANUP_ALARM = 'recoveryPoolCleanup';
const RECOVERY_CLEANUP_DELAY_MIN = 30;
const SESSION_INIT_KEY = 'tabLensInitialized';

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

// Migrate prior-session data to the recovery pool when this is a new browser
// session. chrome.runtime.onStartup is unreliable — macOS auto-launching
// Chrome at login often skips it or fires it after tab events. chrome.storage
// .session is wiped on every browser restart, so its absence signals "first
// event since worker wake". We then disambiguate browser-restart from
// extension-reload: if any tracked (tab.id, url) pair still matches a live
// tab, the IDs weren't recycled and we leave timestamps alone. Otherwise we
// migrate and pre-recover whatever tabs are visible right now.
async function ensureSessionInitialized() {
  const session = await chrome.storage.session.get(SESSION_INIT_KEY);
  if (session[SESSION_INIT_KEY]) return;

  const oldTimestamps = await getTimestamps();
  if (Object.keys(oldTimestamps).length === 0) {
    await chrome.storage.session.set({ [SESSION_INIT_KEY]: true });
    return;
  }

  const tabs = await chrome.tabs.query({});
  const sameSession = tabs.some(t => {
    const old = oldTimestamps[t.id];
    return old && old.url === t.url;
  });

  if (sameSession) {
    await chrome.storage.session.set({ [SESSION_INIT_KEY]: true });
    return;
  }

  const pool = buildRecoveryPool(oldTimestamps);
  const visibleTabs = tabs.filter(t => !isInternalUrl(t.url));
  const newTimestamps = {};
  for (const tab of visibleTabs) {
    const url = tab.url || '';
    const recovered = consumeRecovery(pool, url);
    if (recovered) {
      newTimestamps[tab.id] = {
        openedAt: recovered.openedAt,
        lastVisitedAt: recovered.lastVisitedAt,
        visitCount: recovered.visitCount || 0,
        url,
      };
    } else {
      const now = Date.now();
      newTimestamps[tab.id] = { openedAt: now, lastVisitedAt: now, visitCount: 0, url };
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: newTimestamps, [RECOVERY_POOL_KEY]: pool });
  chrome.alarms.create(RECOVERY_CLEANUP_ALARM, { delayInMinutes: RECOVERY_CLEANUP_DELAY_MIN });
  await chrome.storage.session.set({ [SESSION_INIT_KEY]: true });
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

// onStartup may not fire reliably on macOS auto-launch — ensureSessionInitialized
// handles all the recovery work and is also called by every tab event, so this
// handler just covers the housekeeping (snapshot + daily alarm).
chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    await ensureSessionInitialized();
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
    await chrome.storage.session.set({ [SESSION_INIT_KEY]: true });
    await updateDailySnapshot();
    chrome.alarms.create('dailySnapshot', { periodInMinutes: 1440 });
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.url || isInternalUrl(tab.url)) return;
  enqueue(async () => {
    await ensureSessionInitialized();
    const result = await chrome.storage.local.get([STORAGE_KEY, RECOVERY_POOL_KEY, 'openedLog']);
    const timestamps = result[STORAGE_KEY] || {};
    const pool = result[RECOVERY_POOL_KEY] || {};

    const recovered = consumeRecovery(pool, tab.url);
    if (recovered) {
      timestamps[tab.id] = {
        openedAt: recovered.openedAt,
        lastVisitedAt: recovered.lastVisitedAt,
        visitCount: recovered.visitCount || 0,
        url: tab.url,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: timestamps, [RECOVERY_POOL_KEY]: pool });
      await updateDailySnapshot();
      return;
    }

    const now = Date.now();
    timestamps[tab.id] = { openedAt: now, lastVisitedAt: now, visitCount: 0, url: tab.url };
    const log = result.openedLog || [];
    const cutoff = now - 5 * 24 * 60 * 60 * 1000;
    const pruned = log.filter(e => e.ts > cutoff);
    pruned.push({ ts: now, domain: extractDomain(tab.url) });
    await chrome.storage.local.set({ [STORAGE_KEY]: timestamps, openedLog: pruned });
    await updateDailySnapshot();
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(async () => {
    await ensureSessionInitialized();
    const tab = await chrome.tabs.get(tabId);
    if (isInternalUrl(tab.url)) return;

    const result = await chrome.storage.local.get([STORAGE_KEY, RECOVERY_POOL_KEY]);
    const timestamps = result[STORAGE_KEY] || {};
    const pool = result[RECOVERY_POOL_KEY] || {};
    const now = Date.now();

    if (timestamps[tabId]) {
      timestamps[tabId].lastVisitedAt = now;
      timestamps[tabId].visitCount = (timestamps[tabId].visitCount || 0) + 1;
      await setTimestamps(timestamps);
      return;
    }

    const recovered = consumeRecovery(pool, tab.url || '');
    if (recovered) {
      timestamps[tabId] = {
        openedAt: recovered.openedAt,
        lastVisitedAt: now,
        visitCount: (recovered.visitCount || 0) + 1,
        url: tab.url || '',
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: timestamps, [RECOVERY_POOL_KEY]: pool });
      return;
    }

    timestamps[tabId] = { openedAt: now, lastVisitedAt: now, visitCount: 1, url: tab.url || '' };
    await setTimestamps(timestamps);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  enqueue(async () => {
    await ensureSessionInitialized();
    const result = await chrome.storage.local.get([STORAGE_KEY, RECOVERY_POOL_KEY, 'openedLog']);
    const timestamps = result[STORAGE_KEY] || {};
    const pool = result[RECOVERY_POOL_KEY] || {};

    if (isInternalUrl(changeInfo.url)) {
      if (timestamps[tabId]) {
        delete timestamps[tabId];
        await setTimestamps(timestamps);
      }
      return;
    }

    if (timestamps[tabId]) {
      timestamps[tabId].url = changeInfo.url;
      await setTimestamps(timestamps);
      return;
    }

    const recovered = consumeRecovery(pool, changeInfo.url);
    if (recovered) {
      timestamps[tabId] = {
        openedAt: recovered.openedAt,
        lastVisitedAt: recovered.lastVisitedAt,
        visitCount: recovered.visitCount || 0,
        url: changeInfo.url,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: timestamps, [RECOVERY_POOL_KEY]: pool });
      return;
    }

    const now = Date.now();
    timestamps[tabId] = { openedAt: now, lastVisitedAt: now, visitCount: 0, url: changeInfo.url };
    const log = result.openedLog || [];
    const cutoff = now - 5 * 24 * 60 * 60 * 1000;
    const pruned = log.filter(e => e.ts > cutoff);
    pruned.push({ ts: now, domain: extractDomain(changeInfo.url) });
    await chrome.storage.local.set({ [STORAGE_KEY]: timestamps, openedLog: pruned });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    await ensureSessionInitialized();
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
  } else if (alarm.name === RECOVERY_CLEANUP_ALARM) {
    enqueue(() => chrome.storage.local.remove(RECOVERY_POOL_KEY));
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/manager.html') });
});
