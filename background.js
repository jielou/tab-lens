const STORAGE_KEY = 'timestamps';

async function getTimestamps() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

async function setTimestamps(timestamps) {
  await chrome.storage.local.set({ [STORAGE_KEY]: timestamps });
}

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  const timestamps = await getTimestamps();
  const now = Date.now();
  for (const tab of tabs) {
    if (!timestamps[tab.id]) {
      timestamps[tab.id] = { openedAt: null, lastVisitedAt: null };
    }
  }
  await setTimestamps(timestamps);
});

chrome.tabs.onCreated.addListener(async (tab) => {
  const timestamps = await getTimestamps();
  timestamps[tab.id] = { openedAt: Date.now(), lastVisitedAt: Date.now() };
  await setTimestamps(timestamps);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const timestamps = await getTimestamps();
  if (!timestamps[tabId]) {
    timestamps[tabId] = { openedAt: null, lastVisitedAt: Date.now() };
  } else {
    timestamps[tabId].lastVisitedAt = Date.now();
  }
  await setTimestamps(timestamps);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const timestamps = await getTimestamps();
  delete timestamps[tabId];
  await setTimestamps(timestamps);
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
});
