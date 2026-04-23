let allTabs = [];
let timestamps = {};
let suggestions = [];
let pendingUndo = null;
let undoTimer = null;

async function loadData() {
  allTabs = await chrome.tabs.query({});
  const result = await chrome.storage.local.get('timestamps');
  timestamps = result.timestamps || {};
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

function renderSummaryBar() {
  const windows = groupTabsByWindow(allTabs);
  const windowCount = windows.size;
  const tabCount = allTabs.length;

  const allOpenedAts = allTabs.map(t => t.openedAt).filter(Boolean);
  const oldestTimestamp = allOpenedAts.length ? Math.min(...allOpenedAts) : null;
  const oldestAge = formatAge(oldestTimestamp);

  let longestWindowHtml = '';
  let longestWindowAge = 0;
  let longestWindowLabel = '';
  let winIndex = 1;
  for (const [, winTabs] of windows) {
    const oldest = getWindowOldestTab(winTabs);
    if (oldest && oldest.openedAt) {
      const age = Date.now() - oldest.openedAt;
      if (age > longestWindowAge) {
        longestWindowAge = age;
        longestWindowLabel = `Window ${winIndex}: ${formatAge(oldest.openedAt)}`;
      }
    }
    winIndex++;
  }
  if (longestWindowLabel) {
    longestWindowHtml = `<span class="stat"><strong>${longestWindowLabel}</strong>longest window</span>`;
  }

  const unapplied = suggestions.length;

  document.getElementById('summary-bar').innerHTML = `
    <span class="stat"><strong>${tabCount}</strong>tabs</span>
    <span class="stat"><strong>${windowCount}</strong>windows</span>
    <span class="stat"><strong>${oldestAge}</strong>oldest tab</span>
    ${longestWindowHtml}
    <span class="stat"><strong>${unapplied}</strong>suggested groups</span>
  `;
}

async function init() {
  await loadData();
  renderSummaryBar();
  renderTabList();
  renderSuggestions();
  setupLiveUpdates();
}

document.addEventListener('DOMContentLoaded', init);
