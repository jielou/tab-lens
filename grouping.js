const GROUP_COLORS = ['blue','red','yellow','green','pink','purple','cyan','orange'];

// In Node/Jest: load from tabData module. In browser: already global from tabData.js.
if (typeof require !== 'undefined') {
  var { STOP_WORDS, extractDomain } = require('./tabData'); // eslint-disable-line
}

function extractKeywords(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function isInternal(url) {
  if (!url) return true;
  return url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('chrome-extension://');
}

function suggestGroups(tabs) {
  const eligibleTabs = tabs.filter(t => t.groupId === -1 && !isInternal(t.url));
  const claimedTabIds = new Set();
  const suggestions = [];
  let colorIndex = 0;

  // Domain clustering
  const domainMap = new Map();
  for (const tab of eligibleTabs) {
    const domain = extractDomain(tab.url);
    if (!domain) continue;
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain).push(tab);
  }
  for (const [domain, domainTabs] of domainMap) {
    if (domainTabs.length < 2) continue;
    const tabIds = domainTabs.map(t => t.id);
    tabIds.forEach(id => claimedTabIds.add(id));
    suggestions.push({
      groupName: domain,
      color: GROUP_COLORS[colorIndex++ % GROUP_COLORS.length],
      tabIds,
    });
  }

  // Keyword clustering (only unclaimed tabs)
  const unclaimedTabs = eligibleTabs.filter(t => !claimedTabIds.has(t.id));
  const keywordMap = new Map();
  for (const tab of unclaimedTabs) {
    const text = tab.title || tab.url || '';
    const keywords = extractKeywords(text);
    for (const kw of keywords) {
      if (!keywordMap.has(kw)) keywordMap.set(kw, []);
      keywordMap.get(kw).push(tab);
    }
  }
  const kwClaimedTabIds = new Set();
  for (const [keyword, kwTabs] of keywordMap) {
    if (kwTabs.length < 2) continue;
    const uniqueTabs = kwTabs.filter(t => !kwClaimedTabIds.has(t.id));
    if (uniqueTabs.length < 2) continue;
    const tabIds = uniqueTabs.map(t => t.id);
    tabIds.forEach(id => kwClaimedTabIds.add(id));
    suggestions.push({
      groupName: keyword,
      color: GROUP_COLORS[colorIndex++ % GROUP_COLORS.length],
      tabIds,
    });
  }

  return suggestions;
}

if (typeof module !== 'undefined') {
  module.exports = { suggestGroups, GROUP_COLORS };
}
