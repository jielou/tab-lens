let allTabs = [];
let timestamps = {};
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
    longestWindowHtml = `<span class="stat"><strong>${escapeHtml(longestWindowLabel)}</strong>longest window</span>`;
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
    for (const g of groups) {
      map[g.id] = { title: g.title, color: g.color };
    }
    return map;
  } catch {
    return {};
  }
}

async function renderTabList() {
  const container = document.getElementById('tab-list');
  const windows = groupTabsByWindow(allTabs);
  const nativeGroups = await getNativeGroupInfo();
  let html = '';
  let winIndex = 1;

  for (const [, winTabs] of windows) {
    const winOldest = getWindowOldestTab(winTabs);
    const winAge = winOldest ? formatAge(winOldest.openedAt) : 'unknown';
    html += `<div class="window-section">
      <div class="window-header">Window ${winIndex} — ${winOldest?.openedAt ? `open since ${winAge}` : winAge} — ${winTabs.length} tabs</div>`;

    const byGroup = groupTabsByNativeGroup(winTabs);
    for (const [groupId, groupTabs] of byGroup) {
      if (groupId !== -1 && nativeGroups[groupId]) {
        const g = nativeGroups[groupId];
        const dotColor = GROUP_COLOR_CSS[g.color] || '#888';
        html += `<div class="group-header">
          <span class="group-color-dot" style="background:${dotColor}"></span>
          ${escapeHtml(g.title || '(unnamed group)')}
        </div>`;
      }
      for (const tab of groupTabs) {
        html += renderTabRow(tab);
      }
    }

    html += `</div>`;
    winIndex++;
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

  chrome.tabs.remove(tab.id);
  allTabs = allTabs.filter(t => t.id !== tab.id);
  suggestions = suggestGroups(allTabs);
  await renderTabList();
  renderSummaryBar();

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
  renderSummaryBar();
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
  const groupId = await chrome.tabs.group({ tabIds: validTabIds });
  await chrome.tabGroups.update(groupId, { title: groupName, color });
  await loadData();
  renderSummaryBar();
  await renderTabList();
  renderSuggestions();
}

document.getElementById('toggle-suggestions').addEventListener('click', () => {
  const list = document.getElementById('suggestions-list');
  const btn = document.getElementById('toggle-suggestions');
  const hidden = list.style.display === 'none';
  list.style.display = hidden ? '' : 'none';
  btn.textContent = hidden ? '▲' : '▼';
});

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
    const row = e.target.closest('.tab-row');
    if (row) {
      const tabId = parseInt(row.dataset.tabId);
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(parseInt(row.dataset.windowId), { focused: true });
    }
  });

  await loadData();
  renderSummaryBar();
  await renderTabList();
  renderSuggestions();
  setupLiveUpdates();
}

document.addEventListener('DOMContentLoaded', init);
