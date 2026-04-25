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

function hideBrokenFavicons(root) {
  root.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  });
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
  const stale = staleTabs(tabs);

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

  const scoreRating = score === null ? null
    : score >= 80 ? { label: 'Very focused', color: '#16a34a' }
    : score >= 60 ? { label: 'Moderate', color: '#d97706' }
    : score >= 40 ? { label: 'Scattered', color: '#ea580c' }
    : { label: 'Highly scattered', color: '#dc2626' };

  const meterColor = scoreRating?.color || '#94a3b8';

  const diagnosisBehavior = score === null
    ? 'No visit data yet — behavior insights will appear as you browse.'
    : score >= 60 ? 'Your browsing session looks focused.'
    : score >= 40 ? 'Your session is moderately scattered.'
    : 'Your browsing session looks highly scattered.';

  const topTwo = domains.slice(0, 2).map(d => escapeHtml(d.domain));
  const domainAttention = topTwo.length
    ? `${topTwo.join(' and ')} ${topTwo.length > 1 ? 'are' : 'is'} dominating your attention.`
    : '';
  const staleNote = stale.length
    ? `${stale.length} tab${stale.length !== 1 ? 's' : ''} may be stale.`
    : '';
  const diagnosisDetail = [domainAttention, staleNote].filter(Boolean).join(' ');

  const maxDomainCount = domains[0]?.count || 1;

  const uniqueDomains = new Set(tabs.map(t => extractDomain(t.url)).filter(Boolean)).size;

  const totalClosed = perDay.reduce((s, d) => s + d.count, 0);
  const todayClosed = perDay[perDay.length - 1]?.count || 0;
  const avgClosed = totalClosed / 5;
  const maxDayCount = Math.max(...perDay.map(d => d.count), 1);
  const streakNote = totalClosed === 0
    ? 'No cleanup yet this week. Try closing 5 stale tabs to start.'
    : todayClosed > avgClosed
    ? `Great work — ${todayClosed} tab${todayClosed !== 1 ? 's' : ''} closed today, above your ${avgClosed.toFixed(1)}/day average.`
    : `${totalClosed} tab${totalClosed !== 1 ? 's' : ''} closed this week. Keep it up!`;

  const statsContent = document.getElementById('stats-content');
  statsContent.innerHTML = `
    <div class="diagnosis-card">
      <div class="diagnosis-headline">
        You have <strong>${tabs.length} open tab${tabs.length !== 1 ? 's' : ''}</strong>
        across <strong>${winStats.windowCount} window${winStats.windowCount !== 1 ? 's' : ''}</strong>.
        ${escapeHtml(diagnosisBehavior)}
      </div>
      ${diagnosisDetail ? `<div class="diagnosis-detail">${diagnosisDetail}</div>` : ''}
      <div class="diagnosis-actions">
        ${stale.length ? `<button class="cta-btn" id="review-stale-btn">Review stale tabs (${stale.length})</button>` : ''}
        <button class="cta-btn cta-btn--ghost" id="view-all-tabs-btn">View all tabs →</button>
      </div>
    </div>

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
      <h3>Focus Score</h3>
      <div class="focus-score-wrapper">
        <div>
          <div class="focus-score-number" style="color:${meterColor}">${score !== null ? score + '%' : '—'}</div>
          ${scoreRating ? `<div class="focus-score-label" style="color:${meterColor}">${escapeHtml(scoreRating.label)}</div>` : ''}
        </div>
        <div style="flex:1">
          <div class="focus-meter">
            <div class="focus-meter-fill" style="width:${score !== null ? score : 0}%;background:${meterColor}"></div>
          </div>
          <div class="focus-details">
            ${tabs.length} open tabs · ${winStats.windowCount} window${winStats.windowCount !== 1 ? 's' : ''} · ${uniqueDomains} domain${uniqueDomains !== 1 ? 's' : ''}
            ${distractor ? `<br>Frequent revisits to <em>${escapeHtml((distractor.title || distractor.url || '').slice(0, 35))}</em>` : ''}
          </div>
        </div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Domain Breakdown</h3>
      <div class="stats-row">
        <div class="stats-col" style="flex:2">
          ${domains.length
            ? domains.map(d => `
              <div class="domain-bar-row">
                <span class="domain-bar-label">${escapeHtml(d.domain)}</span>
                <div class="domain-bar-track">
                  <div class="domain-bar-fill" style="width:${Math.round(d.count / maxDomainCount * 100)}%"></div>
                </div>
                <span class="domain-bar-count">${d.count}</span>
                <button class="link-btn view-domain-tabs-btn" data-domain="${escapeHtml(d.domain)}">View →</button>
              </div>`).join('')
            : '<p style="color:var(--color-muted);font-size:13px">No data</p>'}
        </div>
        <div class="stats-col">
          <h4>Windows</h4>
          <p>${winStats.windowCount} window${winStats.windowCount !== 1 ? 's' : ''}</p>
          <p>avg ${winStats.avgTabs} tab${winStats.avgTabs !== 1 ? 's' : ''} / window</p>
        </div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Behavior Insights</h3>
      <div class="insights-grid">

        <div class="insight-card">
          <div class="insight-card-label">Most Revisited Tab</div>
          ${distractor ? `
            <div class="insight-card-tab">
              ${distractor.favIconUrl ? `<img src="${escapeHtml(distractor.favIconUrl)}" width="14" height="14" loading="lazy">` : ''}
              <span class="insight-card-title">${escapeHtml((distractor.title || distractor.url || '').slice(0, 42))}</span>
            </div>
            <div class="insight-card-explanation">You came back to this tab ${distractor.visitCount} time${distractor.visitCount !== 1 ? 's' : ''}. Possible distraction or active work?</div>
            <div class="insight-card-action">
              <button class="link-btn go-tab-btn" data-tab-id="${distractor.id}" data-window-id="${distractor.windowId}">Switch to tab →</button>
            </div>
          ` : '<div class="insight-card-explanation">No visit data yet.</div>'}
        </div>

        <div class="insight-card">
          <div class="insight-card-label">Oldest Open Tab</div>
          ${survivor ? `
            <div class="insight-card-tab">
              ${survivor.favIconUrl ? `<img src="${escapeHtml(survivor.favIconUrl)}" width="14" height="14" loading="lazy">` : ''}
              <span class="insight-card-title">${escapeHtml((survivor.title || survivor.url || '').slice(0, 42))}</span>
            </div>
            <div class="insight-card-explanation">Open for ${escapeHtml(formatAge(survivor.openedAt))}. Still useful, or safe to close?</div>
            <div class="insight-card-action">
              <button class="link-btn close-tab-btn" data-tab-id="${survivor.id}">Close with undo</button>
            </div>
          ` : '<div class="insight-card-explanation">No timestamp data yet.</div>'}
        </div>

        <div class="insight-card">
          <div class="insight-card-label">Domain Obsession</div>
          ${obsession ? `
            <div class="insight-card-title">${escapeHtml(obsession.domain)}</div>
            <div class="insight-card-explanation">${obsession.count} visit${obsession.count !== 1 ? 's' : ''} today. This site dominated your attention.</div>
            <div class="insight-card-action">
              <button class="link-btn view-domain-tabs-btn" data-domain="${escapeHtml(obsession.domain)}">View ${escapeHtml(obsession.domain)} tabs →</button>
            </div>
          ` : '<div class="insight-card-explanation">No visit data yet.</div>'}
        </div>

      </div>
    </div>

    <div class="stats-section">
      <div class="cleanup-header">
        <h3>Cleanup Progress</h3>
        <span class="cleanup-streak">${escapeHtml(streakNote)}</span>
      </div>
      <div class="day-bar">
        ${perDay.map(d => `
          <div class="day-entry">
            <div class="day-bar-visual">
              <div class="day-bar-fill" style="height:${d.count ? Math.max(8, Math.round(d.count / maxDayCount * 40)) : 4}px;${!d.count ? 'background:#E2E8F0' : ''}"></div>
            </div>
            <span class="day-label">${escapeHtml(d.label)}</span>
            <span class="day-count">${d.count || '—'}</span>
          </div>`).join('')}
      </div>
    </div>
  `;

  hideBrokenFavicons(statsContent);

  statsContent.querySelector('#review-stale-btn')?.addEventListener('click', switchToTabsView);
  statsContent.querySelector('#view-all-tabs-btn')?.addEventListener('click', switchToTabsView);
  statsContent.querySelectorAll('.view-domain-tabs-btn').forEach(btn => {
    btn.addEventListener('click', switchToTabsView);
  });
  statsContent.querySelectorAll('.go-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = parseInt(btn.dataset.tabId);
      const windowId = parseInt(btn.dataset.windowId);
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(windowId, { focused: true });
    });
  });
  statsContent.querySelectorAll('.close-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = allTabs.find(t => t.id === parseInt(btn.dataset.tabId));
      if (tab) closeTab(tab);
    });
  });
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
  hideBrokenFavicons(container);
}

function renderTabRow(tab) {
  const title = tab.title || tab.url || '(no title)';
  const domain = extractDomain(tab.url) || tab.url || '';
  const openedAge = formatAge(tab.openedAt);
  const visitedAge = formatAge(tab.lastVisitedAt);
  const favicon = tab.favIconUrl
    ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" loading="lazy">`
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
    ? `<img class="card-favicon" src="${escapeHtml(tab.favIconUrl)}" loading="lazy">`
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

function switchToTabsView() {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="tab-manager"]').classList.add('active');
  document.getElementById('stats-view').classList.add('view-hidden');
  document.getElementById('tab-manager-view').classList.remove('view-hidden');
}

function updateNavTabCount() {
  const el = document.getElementById('nav-tab-count');
  if (el) el.textContent = `${allTabs.length} tabs open`;
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
      updateNavTabCount();
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
      updateNavTabCount();
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
        updateNavTabCount();
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
  updateNavTabCount();
  document.getElementById('nav-cleanup-btn')?.addEventListener('click', switchToTabsView);
  renderStatsView();
  await renderTabList();
  renderSuggestions();
  setupNav();
  setupViewModeToggle();
  setupLiveUpdates();
}

document.addEventListener('DOMContentLoaded', init);
