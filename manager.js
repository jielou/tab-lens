let allTabs = [];
let timestamps = {};
let closedLog = [];
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
  const result = await chrome.storage.local.get(['timestamps', 'closedLog']);
  timestamps = result.timestamps || {};
  closedLog = result.closedLog || [];
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

function renderStatsView() {
  const tabs = allTabs;
  const domains = topDomains(tabs);
  const winStats = windowStats(tabs);
  const score = focusScore(tabs);
  const distractor = topDistractor(tabs);
  const survivor = oldestSurvivor(tabs);
  const obsession = domainObsession(tabs);
  const perDay = closedPerDay(closedLog);

  const allOpenedAts = tabs.map(t => t.openedAt).filter(Boolean);
  const oldestTimestamp = allOpenedAts.length ? Math.min(...allOpenedAts) : null;

  const windows = groupTabsByWindow(tabs);
  let longestWindowLabel = '';
  let longestWindowAge = 0;
  let winIdx = 1;
  for (const [, winTabs] of windows) {
    const oldest = getWindowOldestTab(winTabs);
    if (oldest?.openedAt) {
      const age = Date.now() - oldest.openedAt;
      if (age > longestWindowAge) {
        longestWindowAge = age;
        longestWindowLabel = `Window ${winIdx}: ${formatAge(oldest.openedAt)}`;
      }
    }
    winIdx++;
  }

  const focusLabel = score === null ? ''
    : score >= 80 ? 'Great focus!'
    : score >= 50 ? 'Moderate hoarder'
    : 'Tab hoarder alert';

  document.getElementById('stats-content').innerHTML = `
    <div class="stats-section">
      <h3>Overview</h3>
      <div class="stats-cards">
        <div class="stat-card"><strong>${tabs.length}</strong><span>tabs</span></div>
        <div class="stat-card"><strong>${winStats.windowCount}</strong><span>windows</span></div>
        <div class="stat-card"><strong>${escapeHtml(formatAge(oldestTimestamp))}</strong><span>oldest tab</span></div>
        ${longestWindowLabel ? `<div class="stat-card"><strong>${escapeHtml(longestWindowLabel)}</strong><span>longest window</span></div>` : ''}
        <div class="stat-card"><strong>${suggestions.length}</strong><span>suggested groups</span></div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Domain &amp; Window Breakdown</h3>
      <div class="stats-row">
        <div class="stats-col">
          <h4>Top 5 Domains</h4>
          <ul class="domain-list">
            ${domains.length
              ? domains.map(d => `<li><span class="domain-name">${escapeHtml(d.domain)}</span><span class="domain-count">${d.count} tabs</span></li>`).join('')
              : '<li style="color:#aaa">No data</li>'}
          </ul>
        </div>
        <div class="stats-col">
          <h4>Windows</h4>
          <p>${winStats.windowCount} window${winStats.windowCount !== 1 ? 's' : ''}</p>
          <p>avg ${winStats.avgTabs} tab${winStats.avgTabs !== 1 ? 's' : ''} / window</p>
        </div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Closed Tabs — Last 5 Days</h3>
      <div class="closed-per-day">
        ${perDay.map(d => `
          <div class="day-entry">
            <span class="day-label">${escapeHtml(d.label)}</span>
            <span class="day-count">${d.count || '—'}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="stats-section">
      <h3>Fun Insights</h3>
      <div class="stats-cards">
        <div class="stat-card">
          <strong>${score !== null ? score + '%' : '—'}</strong>
          <span>Focus Score</span>
          <small>${escapeHtml(focusLabel)}</small>
        </div>
        <div class="stat-card">
          <strong>Top Distractor</strong>
          ${distractor ? `
            <div class="insight-tab">
              ${distractor.favIconUrl ? `<img src="${escapeHtml(distractor.favIconUrl)}" width="16" height="16" onerror="this.style.display='none'">` : ''}
              <span>${escapeHtml((distractor.title || distractor.url || '').slice(0, 40))}</span>
            </div>
            <small>${distractor.visitCount} visits</small>
          ` : '<span style="color:#aaa;font-size:12px">No data yet</span>'}
        </div>
        <div class="stat-card">
          <strong>Oldest Survivor</strong>
          ${survivor ? `
            <div class="insight-tab">
              ${survivor.favIconUrl ? `<img src="${escapeHtml(survivor.favIconUrl)}" width="16" height="16" onerror="this.style.display='none'">` : ''}
              <span>${escapeHtml((survivor.title || survivor.url || '').slice(0, 40))}</span>
            </div>
            <small>Open for ${formatAge(survivor.openedAt)}</small>
          ` : '<span style="color:#aaa;font-size:12px">No data yet</span>'}
        </div>
        <div class="stat-card">
          <strong>Domain Obsession</strong>
          ${obsession ? `
            <div class="insight-domain">${escapeHtml(obsession.domain)}</div>
            <small>${obsession.count} total visits</small>
          ` : '<span style="color:#aaa;font-size:12px">No data yet</span>'}
        </div>
      </div>
    </div>
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
    for (const g of groups) map[g.id] = { title: g.title, color: g.color };
    return map;
  } catch {
    return {};
  }
}

async function renderTabList() {
  const container = document.getElementById('tab-list');
  const viewMode = localStorage.getItem('viewMode') || 'list';
  const nativeGroups = await getNativeGroupInfo();
  const byGroup = groupTabsByNativeGroup(allTabs);
  let html = '';

  for (const [groupId, groupTabs] of byGroup) {
    if (groupTabs.length === 0) continue;
    if (groupId !== -1 && nativeGroups[groupId]) {
      const g = nativeGroups[groupId];
      const dotColor = GROUP_COLOR_CSS[g.color] || '#888';
      html += `<div class="group-header">
        <span class="group-color-dot" style="background:${dotColor}"></span>
        ${escapeHtml(g.title || '(unnamed group)')}
      </div>`;
    }
    if (viewMode === 'grid') {
      html += `<div class="tab-grid">`;
      for (const tab of groupTabs) html += renderTabCard(tab);
      html += `</div>`;
    } else {
      for (const tab of groupTabs) html += renderTabRow(tab);
    }
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

function renderTabCard(tab) {
  const title = tab.title || tab.url || '(no title)';
  const domain = extractDomain(tab.url) || tab.url || '';
  const openedAge = formatAge(tab.openedAt);
  const favicon = tab.favIconUrl
    ? `<img class="card-favicon" src="${escapeHtml(tab.favIconUrl)}" onerror="this.style.display='none'">`
    : `<span class="card-favicon"></span>`;
  return `
    <div class="tab-card" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" title="${escapeHtml(title)}">
      ${favicon}
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="card-domain">${escapeHtml(domain)}</div>
      <div class="card-age">${openedAge}</div>
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

  chrome.tabs.remove(tab.id).catch(err =>
    console.error('[tab-manager] remove failed:', err)
  );
  allTabs = allTabs.filter(t => t.id !== tab.id);
  suggestions = suggestGroups(allTabs);
  renderStatsView();
  await renderTabList();
  renderSuggestions();
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
  renderStatsView();
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
  try {
    const groupId = await chrome.tabs.group({ tabIds: validTabIds });
    await chrome.tabGroups.update(groupId, { title: groupName, color });
  } catch (err) {
    console.error('[tab-manager] applyGroup failed:', err);
  }
  await loadData();
  renderStatsView();
  await renderTabList();
  renderSuggestions();
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.getElementById('stats-view').classList.toggle('view-hidden', view !== 'stats');
      document.getElementById('tab-manager-view').classList.toggle('view-hidden', view !== 'tab-manager');
    });
  });
}

function setupViewModeToggle() {
  const btn = document.getElementById('toggle-view-mode');
  function updateLabel() {
    const mode = localStorage.getItem('viewMode') || 'list';
    btn.textContent = mode === 'list' ? 'Switch to Grid' : 'Switch to List';
  }
  updateLabel();
  btn.addEventListener('click', async () => {
    const current = localStorage.getItem('viewMode') || 'list';
    localStorage.setItem('viewMode', current === 'list' ? 'grid' : 'list');
    updateLabel();
    await renderTabList();
  });
}

document.getElementById('toggle-suggestions').addEventListener('click', () => {
  const list = document.getElementById('suggestions-list');
  const btn = document.getElementById('toggle-suggestions');
  const hidden = list.style.display === 'none';
  list.style.display = hidden ? '' : 'none';
  btn.textContent = hidden ? '▲' : '▼';
});

function setupLiveUpdates() {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (pendingUndo && pendingUndo.tabId === tabId) return;
    try {
      allTabs = allTabs.filter(t => t.id !== tabId);
      suggestions = suggestGroups(allTabs);
      renderStatsView();
      await renderTabList();
      renderSuggestions();
    } catch (err) {
      console.error('[tab-manager] onRemoved render failed:', err);
    }
  });

  chrome.tabs.onCreated.addListener(async () => {
    try {
      await new Promise(r => setTimeout(r, 200));
      await loadData();
      renderStatsView();
      await renderTabList();
      renderSuggestions();
    } catch (err) {
      console.error('[tab-manager] onCreated render failed:', err);
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.favIconUrl || changeInfo.url) {
      try {
        await loadData();
        renderStatsView();
        await renderTabList();
        renderSuggestions();
      } catch (err) {
        console.error('[tab-manager] onUpdated render failed:', err);
      }
    }
  });
}

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
    const row = e.target.closest('.tab-row, .tab-card');
    if (row) {
      const tabId = parseInt(row.dataset.tabId);
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(parseInt(row.dataset.windowId), { focused: true });
    }
  });

  await loadData();
  renderStatsView();
  await renderTabList();
  renderSuggestions();
  setupNav();
  setupViewModeToggle();
  setupLiveUpdates();
}

document.addEventListener('DOMContentLoaded', init);
