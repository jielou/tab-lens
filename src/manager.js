let allTabs = [];
let timestamps = {};
let closedLog = [];
let openedLog = [];
let dailySnapshots = {};
let suggestions = [];
let pendingUndo = null;
let undoTimer = null;
let searchQuery = '';

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

function setupDomainFavicons(root) {
  root.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', () => {
      const row = img.closest('.domain-row');
      if (!row) { img.style.display = 'none'; return; }
      const name = row.querySelector('.domain-name')?.textContent || '';
      const fallback = document.createElement('div');
      fallback.className = 'domain-fallback';
      fallback.style.background = getDomainColor(name);
      fallback.textContent = (name[0] || '?').toUpperCase();
      img.replaceWith(fallback);
    }, { once: true });
  });
}

function setupListFavicons(root) {
  root.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', () => {
      const container = img.closest('[data-domain]');
      if (!container) { img.style.display = 'none'; return; }
      const domain = container.dataset.domain || '';
      const isFeatured = img.closest('.alert-featured, .zombie-featured') !== null;
      const size = isFeatured ? 34 : 20;
      const radius = isFeatured ? 8 : 5;
      const fallback = document.createElement('div');
      fallback.style.cssText = `width:${size}px;height:${size}px;border-radius:${radius}px;background:${getDomainColor(domain)};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:${Math.round(size * 0.38)}px;font-weight:700;color:#fff;`;
      fallback.textContent = (domain[0] || '?').toUpperCase();
      img.replaceWith(fallback);
    }, { once: true });
  });
}

function formatAgeShort(timestamp) {
  if (timestamp === null || timestamp === undefined) return '—';
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffDay = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDay > 0) return `${diffDay}d`;
  const diffHour = Math.floor(diffMs / (60 * 60 * 1000));
  if (diffHour > 0) return `${diffHour}h`;
  const diffMin = Math.floor(diffMs / (60 * 1000));
  if (diffMin > 0) return `${diffMin}m`;
  return 'now';
}

function formatDuration(timestamp) {
  if (timestamp === null || timestamp === undefined) return 'unknown';
  const diffMs = Math.max(0, Date.now() - timestamp);
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours > 0) return `${hours} hr${hours !== 1 ? 's' : ''}`;
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins > 0) return `${mins} min${mins !== 1 ? 's' : ''}`;
  return 'just now';
}

const DOMAIN_FALLBACK_COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#14B8A6'];

function getDomainColor(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = ((hash << 5) - hash) + domain.charCodeAt(i);
  return DOMAIN_FALLBACK_COLORS[Math.abs(hash) % DOMAIN_FALLBACK_COLORS.length];
}

function renderDomainFallback(domain) {
  const color = getDomainColor(domain || '');
  const letter = (domain || '?')[0].toUpperCase();
  return `<div class="domain-fallback" style="background:${color}">${escapeHtml(letter)}</div>`;
}

async function loadData() {
  allTabs = await chrome.tabs.query({});
  allTabs = allTabs.filter(t => !isInternalUrl(t.url));
  const result = await chrome.storage.local.get(['timestamps', 'closedLog', 'openedLog', 'dailySnapshots']);
  timestamps = result.timestamps || {};
  closedLog = result.closedLog || [];
  openedLog = result.openedLog || [];
  dailySnapshots = result.dailySnapshots || {};
  allTabs = mergeTabsWithTimestamps(allTabs, timestamps);
  suggestions = suggestGroups(allTabs);
}

/* ── Overview ── */

function renderStatsView() {
  const tabs = allTabs;
  const domains = topDomains(tabs);
  const winStats = windowStats(tabs);
  const activity = todayActivity(tabs, closedLog, openedLog);
  const distractor = topDistractor(tabs);
  const survivor = oldestSurvivor(tabs);
  const untouched = longestUntouched(tabs);
  const trend = tabTrend14Days(dailySnapshots, tabs.length);
  const distractors = topDistractors(tabs, 5);
  const zombies = topStaleTabs(tabs, 5);

  // Header
  document.querySelector('.overview-header .tab-count-highlight').textContent = tabs.length;
  const todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  document.getElementById('overview-subtitle').textContent =
    `Today, ${todayStr} · ${winStats.windowCount} window${winStats.windowCount !== 1 ? 's' : ''}`;

  // Mini stat cards
  const gVal = document.getElementById('growth-value');
  const gMeta = document.getElementById('growth-meta');
  if (activity.opened === 0 && activity.closed === 0) {
    gVal.textContent = '—';
    gMeta.textContent = 'No activity today';
  } else {
    const prefix = activity.netGrowth > 0 ? '+' : '';
    gVal.textContent = `${prefix}${activity.netGrowth}`;
    gMeta.textContent = `${activity.opened} opened · ${activity.closed} closed`;
  }

  const vVal = document.getElementById('visited-value');
  const vMeta = document.getElementById('visited-meta');
  if (distractor && distractor.visitCount > 0) {
    vVal.textContent = `${distractor.visitCount}×`;
    const d = extractDomain(distractor.url);
    vMeta.textContent = `${d || 'unknown'} · still open`;
  } else {
    vVal.textContent = '—';
    vMeta.textContent = 'No data';
  }

  const oVal = document.getElementById('oldest-value');
  const oMeta = document.getElementById('oldest-meta');
  if (survivor) {
    oVal.textContent = formatAgeShort(survivor.openedAt);
    oMeta.textContent = extractDomain(survivor.url) || survivor.url || 'unknown';
  } else {
    oVal.textContent = '—';
    oMeta.textContent = 'No data';
  }

  const uVal = document.getElementById('untouched-value');
  const uMeta = document.getElementById('untouched-meta');
  if (untouched) {
    uVal.textContent = formatAgeShort(untouched.lastVisitedAt);
    uMeta.textContent = extractDomain(untouched.url) || untouched.url || 'unknown';
  } else {
    uVal.textContent = '—';
    uMeta.textContent = 'No data';
  }

  // Duplicate tabs
  const dupVal = document.getElementById('duplicate-value');
  const dupMeta = document.getElementById('duplicate-meta');
  const dupCard = document.getElementById('duplicate-card');
  const dupResult = findDuplicateTabs(tabs);
  if (dupResult.count > 0) {
    dupVal.textContent = dupResult.count;
    dupMeta.textContent = 'Click to clean up';
    dupCard.style.opacity = '1';
    dupCard.style.pointerEvents = 'auto';
  } else {
    dupVal.textContent = '0';
    dupMeta.textContent = 'No duplicates';
    dupCard.style.opacity = '0.6';
    dupCard.style.pointerEvents = 'none';
  }

  // Chart
  renderChart(trend);

  // Top Domains
  const domainsContainer = document.getElementById('top-domains-list');
  if (domains.length === 0) {
    domainsContainer.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No data</p>';
  } else {
    const maxCount = domains[0].count;
    domainsContainer.innerHTML = domains.map(d => {
      const sampleTab = tabs.find(t => extractDomain(t.url) === d.domain && t.favIconUrl);
      const icon = sampleTab ? `<img src="${escapeHtml(sampleTab.favIconUrl)}" loading="lazy" alt="">` : renderDomainFallback(d.domain);
      return `
        <div class="domain-row">
          ${icon}
          <div class="domain-info">
            <div class="domain-header">
              <span class="domain-name">${escapeHtml(d.domain)}</span>
              <span class="domain-count">${d.count}</span>
            </div>
            <div class="domain-track">
              <div class="domain-fill" style="width:${Math.round(d.count / maxCount * 100)}%"></div>
            </div>
          </div>
        </div>`;
    }).join('');
    setupDomainFavicons(domainsContainer);
  }

  // Distraction Alert
  const distContainer = document.getElementById('distraction-list');
  if (distractors.length === 0) {
    distContainer.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No revisit data yet.</p>';
  } else {
    const [firstD, ...restD] = distractors;
    const firstTitle = escapeHtml((firstD.title || firstD.url || 'Untitled').slice(0, 56));
    const firstIcon = firstD.favIconUrl ? `<img src="${escapeHtml(firstD.favIconUrl)}" loading="lazy" alt="">` : '';
    distContainer.innerHTML = `
      <div class="alert-featured" data-tab-id="${firstD.id}" data-window-id="${firstD.windowId}" data-domain="${escapeHtml(extractDomain(firstD.url))}">
        ${firstIcon}
        <div class="featured-info">
          <div class="featured-title">${firstTitle}</div>
          <div class="featured-desc">Visited <strong>${firstD.visitCount}×</strong> today · still open</div>
        </div>
      </div>
      <div class="alert-rest">
        ${restD.map(tab => {
          const title = escapeHtml((tab.title || tab.url || 'Untitled').slice(0, 56));
          const icon = tab.favIconUrl ? `<img src="${escapeHtml(tab.favIconUrl)}" loading="lazy" alt="">` : '';
          return `
            <div class="alert-row" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" data-domain="${escapeHtml(extractDomain(tab.url))}">
              ${icon}
              <span class="row-title">${title}</span>
              <span class="row-count">${tab.visitCount}×</span>
            </div>`;
        }).join('')}
      </div>`;
    setupListFavicons(distContainer);
    distContainer.querySelectorAll('.alert-featured, .alert-row').forEach(el => {
      el.addEventListener('click', () => {
        const tabId = parseInt(el.dataset.tabId);
        const windowId = parseInt(el.dataset.windowId);
        chrome.tabs.update(tabId, { active: true });
        chrome.windows.update(windowId, { focused: true });
      });
    });
  }

  // Zombie Tabs
  const zombieContainer = document.getElementById('zombie-list');
  if (zombies.length === 0) {
    zombieContainer.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No zombie tabs — everything is fresh!</p>';
  } else {
    const [firstZ, ...restZ] = zombies;
    const firstTitle = escapeHtml((firstZ.title || firstZ.url || 'Untitled').slice(0, 56));
    const firstIcon = firstZ.favIconUrl ? `<img src="${escapeHtml(firstZ.favIconUrl)}" loading="lazy" alt="">` : '';
    const firstAge = formatDuration(firstZ.lastVisitedAt);
    zombieContainer.innerHTML = `
      <div class="zombie-featured" data-tab-id="${firstZ.id}" data-window-id="${firstZ.windowId}" data-domain="${escapeHtml(extractDomain(firstZ.url))}">
        ${firstIcon}
        <div class="featured-info">
          <div class="featured-title">${firstTitle}</div>
          <div class="featured-desc">Untouched for <strong>${firstAge}</strong></div>
        </div>
      </div>
      <div class="zombie-rest">
        ${restZ.map(tab => {
          const title = escapeHtml((tab.title || tab.url || 'Untitled').slice(0, 56));
          const icon = tab.favIconUrl ? `<img src="${escapeHtml(tab.favIconUrl)}" loading="lazy" alt="">` : '';
          const age = formatDuration(tab.lastVisitedAt);
          return `
            <div class="zombie-row" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" data-domain="${escapeHtml(extractDomain(tab.url))}">
              ${icon}
              <span class="row-title">${title}</span>
              <span class="row-time">${age}</span>
            </div>`;
        }).join('')}
      </div>`;
    setupListFavicons(zombieContainer);
    zombieContainer.querySelectorAll('.zombie-featured, .zombie-row').forEach(el => {
      el.addEventListener('click', () => {
        const tabId = parseInt(el.dataset.tabId);
        const windowId = parseInt(el.dataset.windowId);
        chrome.tabs.update(tabId, { active: true });
        chrome.windows.update(windowId, { focused: true });
      });
    });
  }
}

function renderChart(days) {
  const gridGroup = document.getElementById('chart-grid');
  const areaPath = document.getElementById('chart-area');
  const linePath = document.getElementById('chart-line');
  const pointsGroup = document.getElementById('chart-points');
  const labelsGroup = document.getElementById('chart-labels');

  const W = 480, H = 160;
  const pad = { t: 16, r: 10, b: 30, l: 32 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const counts = days.map(d => d.count);
  const minC = Math.min(...counts) - 2;
  const maxC = Math.max(...counts) + 2;
  const yMax = maxC;
  const yMin = Math.max(0, minC);

  const yScale = v => pad.t + ch - ((v - yMin) / (yMax - yMin)) * ch;
  const xScale = i => pad.l + i * (cw / (days.length - 1));

  const pts = days.map((d, i) => [xScale(i), yScale(d.count)]);

  // Grid lines & Y labels (3 lines: top, mid, bottom)
  let gridHtml = '';
  let labelHtml = '';
  [0, 0.5, 1].forEach(t => {
    const y = pad.t + ch * t;
    gridHtml += `<line class="chart-grid-line" x1="${pad.l}" y1="${y}" x2="${pad.l + cw}" y2="${y}"/>`;
    labelHtml += `<text class="chart-y-label" x="${pad.l - 6}" y="${y + 4}">${Math.round(yMax - t * (yMax - yMin))}</text>`;
  });
  gridGroup.innerHTML = gridHtml;
  labelsGroup.innerHTML = labelHtml;

  // Line path
  const lineD = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  linePath.setAttribute('d', lineD);

  // Area fill
  const areaD = `${lineD} L${pts[pts.length-1][0].toFixed(1)},${(pad.t + ch).toFixed(1)} L${pts[0][0].toFixed(1)},${(pad.t + ch).toFixed(1)} Z`;
  areaPath.setAttribute('d', areaD);

  // Points + X labels (show every other label to avoid crowding)
  let pointsHtml = '';
  pts.forEach((p, i) => {
    const r = i === pts.length - 1 ? 4.5 : 3;
    const cls = i === pts.length - 1 ? 'chart-point-end' : 'chart-point';
    pointsHtml += `<circle class="${cls}" cx="${p[0]}" cy="${p[1]}" r="${r}"/>`;
    // Show label for every other day to prevent crowding
    if (i % 2 === 0 || i === pts.length - 1) {
      labelHtml += `<text class="chart-label" x="${p[0]}" y="${pad.t + ch + 16}">${escapeHtml(days[i].label)}</text>`;
    }
  });
  pointsGroup.innerHTML = pointsHtml;
  labelsGroup.innerHTML = labelHtml;
}

/* ── Tab Manager ── */

function groupTabsByWindow(tabs) {
  const windows = new Map();
  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) windows.set(tab.windowId, []);
    windows.get(tab.windowId).push(tab);
  }
  return windows;
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

  const filtered = searchQuery
    ? allTabs.filter(t =>
        (t.title || '').toLowerCase().includes(searchQuery) ||
        (t.url || '').toLowerCase().includes(searchQuery)
      )
    : allTabs;

  const byGroup = groupTabsByNativeGroup(filtered);
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
  updateTabManagerStats();
}

function renderTabRow(tab) {
  const title = tab.title || tab.url || '(no title)';
  const domain = extractDomain(tab.url) || tab.url || '';
  const openedAge = formatAge(tab.openedAt);
  const visitedAge = formatAge(tab.lastVisitedAt);
  const domainColor = getDomainColor(domain);
  const favicon = tab.favIconUrl
    ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" loading="lazy">`
    : `<span class="tab-favicon"></span>`;
  const visitBadge = (tab.visitCount || 0) > 10
    ? `<span class="visit-badge">${tab.visitCount}×</span>`
    : '';
  return `
    <div class="tab-row" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" style="border-left-color:${domainColor}">
      ${favicon}
      <div class="tab-info">
        <div class="tab-title">${escapeHtml(title)}</div>
        <div class="tab-meta">
          <span>${escapeHtml(domain)}</span>
          <span>opened: ${openedAge}</span>
          <span>visited: ${visitedAge}</span>
          ${visitBadge}
        </div>
      </div>
      <button class="tab-close" data-tab-id="${tab.id}" title="Close tab">×</button>
    </div>`;
}

function renderTabCard(tab) {
  const title = tab.title || tab.url || '(no title)';
  const domain = extractDomain(tab.url) || tab.url || '';
  const openedAge = formatAge(tab.openedAt);
  const domainColor = getDomainColor(domain);
  const favicon = tab.favIconUrl
    ? `<img class="card-favicon" src="${escapeHtml(tab.favIconUrl)}" loading="lazy">`
    : `<span class="card-favicon"></span>`;
  const visitBadge = (tab.visitCount || 0) > 10
    ? `<span class="visit-badge">${tab.visitCount}×</span>`
    : '';
  return `
    <div class="tab-card" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" title="${escapeHtml(title)}" style="border-top-color:${domainColor}">
      ${favicon}
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="card-domain">${escapeHtml(domain)}</div>
      <div class="card-meta-row">
        <span class="card-age">${openedAge}</span>
        ${visitBadge}
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

  chrome.tabs.remove(tab.id).catch(err =>
    console.error('[tab-manager] remove failed:', err)
  );
  allTabs = allTabs.filter(t => t.id !== tab.id);
  suggestions = suggestGroups(allTabs);
  renderStatsView();
  updateNavCounts();
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

function showToastMessage(msg) {
  const toast = document.getElementById('toast');
  toast.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
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
  updateNavCounts();
  await renderTabList();
  renderSuggestions();
}

function updateTabManagerStats() {
  const el = document.getElementById('tab-manager-stats');
  if (!el) return;
  const windowCount = new Set(allTabs.map(t => t.windowId)).size;
  const groupCount = new Set(allTabs.map(t => t.groupId).filter(g => g !== -1)).size;
  const ungroupedCount = allTabs.filter(t => t.groupId === -1).length;
  el.innerHTML = `
    <span><strong>${allTabs.length}</strong> tabs</span>
    <span><strong>${windowCount}</strong> window${windowCount !== 1 ? 's' : ''}</span>
    <span><strong>${groupCount}</strong> group${groupCount !== 1 ? 's' : ''}</span>
    <span><strong>${ungroupedCount}</strong> ungrouped</span>
  `;
}

function renderSuggestions() {
  const list = document.getElementById('suggestions-list');
  if (suggestions.length === 0) {
    list.innerHTML = '<p style="color:#888;font-size:13px;">No suggestions — all tabs are already grouped or unique.</p>';
    return;
  }

  list.innerHTML = suggestions.map((s, i) => {
    const tabs = s.tabIds.map(id => allTabs.find(t => t.id === id)).filter(Boolean);
    const tabTitles = tabs.slice(0, 2).map(t =>
      `<div class="suggestion-tab-title">${escapeHtml(t.title || t.url)}</div>`
    ).join('');
    const more = tabs.length > 2 ? `<div style="color:#888;font-size:11px;margin-top:2px">+${tabs.length - 2} more</div>` : '';
    const dotColor = GROUP_COLOR_CSS[s.color] || s.color || '#888';
    return `
      <div class="suggestion-card">
        <div class="suggestion-header">
          <span class="suggestion-color-dot" style="background:${dotColor}"></span>
          <span class="suggestion-name">${escapeHtml(s.groupName)}</span>
          <span class="suggestion-count">${tabs.length}</span>
        </div>
        <div class="suggestion-tabs">${tabTitles}${more}</div>
        <button class="apply-btn" data-suggestion-index="${i}">Preview & Apply</button>
      </div>`;
  }).join('');

  list.querySelectorAll('.apply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.suggestionIndex);
      showGroupPreview(suggestions[i]);
    });
  });
}

let pendingGroupSuggestion = null;

function showGroupPreview(suggestion) {
  pendingGroupSuggestion = suggestion;
  const modal = document.getElementById('group-preview-modal');
  const tabList = document.getElementById('modal-tab-list');

  const groupTabs = suggestion.tabIds.map(id => allTabs.find(t => t.id === id)).filter(Boolean);
  const dotColor = GROUP_COLOR_CSS[suggestion.color] || suggestion.color || '#888';

  document.querySelector('.modal-color-dot').style.background = dotColor;
  document.querySelector('.modal-title').textContent = `Preview: ${suggestion.groupName}`;
  document.querySelector('.modal-subtitle').textContent =
    `${groupTabs.length} tab${groupTabs.length !== 1 ? 's' : ''} will be grouped`;

  tabList.innerHTML = groupTabs.map(tab => {
    const icon = tab.favIconUrl
      ? `<img src="${escapeHtml(tab.favIconUrl)}" loading="lazy" alt="">`
      : renderDomainFallback(extractDomain(tab.url));
    return `
      <div class="modal-tab-row">
        ${icon}
        <div class="modal-tab-info">
          <div class="modal-tab-title">${escapeHtml(tab.title || tab.url || 'Untitled')}</div>
          <div class="modal-tab-domain">${escapeHtml(extractDomain(tab.url) || tab.url || '')}</div>
        </div>
      </div>`;
  }).join('');

  setupDomainFavicons(tabList);
  modal.classList.remove('hidden');
}

function hideGroupPreview() {
  pendingGroupSuggestion = null;
  document.getElementById('group-preview-modal').classList.add('hidden');
}

let pendingDeleteAction = null;

function showDeleteConfirm() {
  const { count, duplicates } = findDuplicateTabs(allTabs);
  if (count === 0) return;
  pendingDeleteAction = async () => {
    for (const tab of duplicates) {
      try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
    }
    await loadData();
    renderStatsView();
    updateNavCounts();
    await renderTabList();
    renderSuggestions();
  };
  document.getElementById('confirm-title').textContent = `Remove ${count} duplicate tab${count !== 1 ? 's' : ''}?`;
  document.getElementById('confirm-subtitle').textContent =
    `${count} tab${count !== 1 ? 's' : ''} with duplicate URLs will be closed`;
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function hideDeleteConfirm() {
  pendingDeleteAction = null;
  document.getElementById('confirm-modal').classList.add('hidden');
}

async function removeDuplicateTabs() {
  const { duplicates } = findDuplicateTabs(allTabs);
  if (duplicates.length === 0) return;
  for (const tab of duplicates) {
    try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
  }
  await loadData();
  renderStatsView();
  updateNavCounts();
  await renderTabList();
  renderSuggestions();
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
  updateNavCounts();
  await renderTabList();
  renderSuggestions();
}

/* ── Navigation & View switching ── */

function switchToTabsView() {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="tab-manager"]').classList.add('active');
  document.getElementById('overview-view').classList.add('view-hidden');
  document.getElementById('tab-manager-view').classList.remove('view-hidden');
}

function switchToOverviewView() {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="overview"]').classList.add('active');
  document.getElementById('tab-manager-view').classList.add('view-hidden');
  document.getElementById('overview-view').classList.remove('view-hidden');
}

function updateNavCounts() {
  const winStats = windowStats(allTabs);
  const tabCountEl = document.getElementById('nav-tab-count');
  const winCountEl = document.getElementById('nav-window-count');
  if (tabCountEl) tabCountEl.textContent = `${allTabs.length} tabs`;
  if (winCountEl) winCountEl.textContent = `${winStats.windowCount} window${winStats.windowCount !== 1 ? 's' : ''}`;
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === 'overview') switchToOverviewView();
      else if (view === 'tab-manager') switchToTabsView();
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

/* ── Live updates ── */

function setupLiveUpdates() {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (pendingUndo && pendingUndo.tabId === tabId) return;
    try {
      await loadData();
      suggestions = suggestGroups(allTabs);
      renderStatsView();
      updateNavCounts();
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
      updateNavCounts();
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
        updateNavCounts();
        await renderTabList();
        renderSuggestions();
      } catch (err) {
        console.error('[tab-manager] onUpdated render failed:', err);
      }
    }
  });
}

/* ── Init ── */

async function init() {
  // Tab list click handler
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

  // Search
  document.getElementById('tab-search').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderTabList();
  });

  // Suggestions toggle
  document.getElementById('toggle-suggestions').addEventListener('click', () => {
    const list = document.getElementById('suggestions-list');
    const btn = document.getElementById('toggle-suggestions');
    const hidden = list.style.display === 'none';
    list.style.display = hidden ? '' : 'none';
    btn.textContent = hidden ? '▲' : '▼';
  });

  // Group preview modal
  document.getElementById('modal-cancel').addEventListener('click', hideGroupPreview);
  document.querySelector('.modal-overlay').addEventListener('click', hideGroupPreview);
  document.getElementById('modal-apply').addEventListener('click', async () => {
    if (!pendingGroupSuggestion) return;
    await applyGroup(pendingGroupSuggestion);
    hideGroupPreview();
  });

  // Duplicate tabs cleanup
  document.getElementById('duplicate-card').addEventListener('click', () => {
    showDeleteConfirm();
  });

  // Reset stats
  document.getElementById('reset-stats-btn').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({});
    const visibleTabs = tabs.filter(t => !isInternalUrl(t.url));
    const now = Date.now();
    const timestamps = {};
    const openedLog = [];
    for (const tab of visibleTabs) {
      timestamps[tab.id] = { openedAt: now, lastVisitedAt: now, visitCount: 0, url: tab.url || '' };
      const domain = extractDomain(tab.url || '');
      openedLog.push({ ts: now, domain });
    }
    // Write today's snapshot so tab trend isn't empty
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const key = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
    const dailySnapshots = { [key]: visibleTabs.length };
    await chrome.storage.local.set({ timestamps, openedLog, closedLog: [], dailySnapshots });
    await loadData();
    renderStatsView();
    updateNavCounts();
    await renderTabList();
    showToastMessage('Stats reset · current tabs counted as opened today');
  });

  // Confirm modal
  document.getElementById('confirm-cancel').addEventListener('click', hideDeleteConfirm);
  document.querySelector('#confirm-modal .modal-overlay').addEventListener('click', hideDeleteConfirm);
  document.getElementById('confirm-action').addEventListener('click', async () => {
    if (!pendingDeleteAction) return;
    await pendingDeleteAction();
    hideDeleteConfirm();
  });

  await loadData();
  updateNavCounts();
  setupNav();
  setupViewModeToggle();
  renderStatsView();
  await renderTabList();
  renderSuggestions();
  setupLiveUpdates();
}

document.addEventListener('DOMContentLoaded', init);
