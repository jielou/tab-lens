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
