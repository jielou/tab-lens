const {
  topDomains, windowStats, focusScore, topDistractor,
  oldestSurvivor, domainObsession, closedPerDay, staleTabs,
} = require('../src/stats');

function makeTab(overrides = {}) {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    windowId: 1,
    openedAt: Date.now() - 1000,
    lastVisitedAt: Date.now(),
    visitCount: 1,
    favIconUrl: '',
    groupId: -1,
    ...overrides,
  };
}

describe('topDomains', () => {
  test('returns domains sorted by tab count', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://github.com/a' }),
      makeTab({ id: 2, url: 'https://github.com/b' }),
      makeTab({ id: 3, url: 'https://github.com/c' }),
      makeTab({ id: 4, url: 'https://google.com/a' }),
      makeTab({ id: 5, url: 'https://google.com/b' }),
      makeTab({ id: 6, url: 'https://reddit.com/a' }),
    ];
    const result = topDomains(tabs);
    expect(result[0]).toEqual({ domain: 'github.com', count: 3 });
    expect(result[1]).toEqual({ domain: 'google.com', count: 2 });
    expect(result[2]).toEqual({ domain: 'reddit.com', count: 1 });
  });

  test('returns at most 5 domains', () => {
    const tabs = ['a','b','c','d','e','f'].map((x, i) =>
      makeTab({ id: i, url: `https://${x}.com/page` })
    );
    expect(topDomains(tabs).length).toBeLessThanOrEqual(5);
  });

  test('skips tabs with no extractable domain', () => {
    const tabs = [
      makeTab({ id: 1, url: '' }),
      makeTab({ id: 2, url: 'https://github.com/a' }),
      makeTab({ id: 3, url: 'https://github.com/b' }),
    ];
    const result = topDomains(tabs);
    expect(result[0].domain).toBe('github.com');
    expect(result).toHaveLength(1);
  });

  test('returns empty array for no tabs', () => {
    expect(topDomains([])).toEqual([]);
  });
});

describe('windowStats', () => {
  test('returns window count and average tabs per window', () => {
    const tabs = [
      makeTab({ id: 1, windowId: 1 }),
      makeTab({ id: 2, windowId: 1 }),
      makeTab({ id: 3, windowId: 2 }),
    ];
    expect(windowStats(tabs)).toEqual({ windowCount: 2, avgTabs: 2 });
  });

  test('returns zeros for empty tabs', () => {
    expect(windowStats([])).toEqual({ windowCount: 0, avgTabs: 0 });
  });

  test('single window', () => {
    const tabs = [makeTab({ id: 1, windowId: 1 }), makeTab({ id: 2, windowId: 1 })];
    expect(windowStats(tabs)).toEqual({ windowCount: 1, avgTabs: 2 });
  });
});

describe('focusScore', () => {
  test('returns percentage of tabs with visitCount > 0', () => {
    const tabs = [
      makeTab({ id: 1, visitCount: 3 }),
      makeTab({ id: 2, visitCount: 0 }),
      makeTab({ id: 3, visitCount: 1 }),
      makeTab({ id: 4, visitCount: 0 }),
    ];
    expect(focusScore(tabs)).toBe(50);
  });

  test('returns null for empty tabs', () => {
    expect(focusScore([])).toBeNull();
  });

  test('returns 100 when all tabs visited', () => {
    const tabs = [makeTab({ id: 1, visitCount: 1 }), makeTab({ id: 2, visitCount: 2 })];
    expect(focusScore(tabs)).toBe(100);
  });

  test('returns 0 when no tabs visited', () => {
    const tabs = [makeTab({ id: 1, visitCount: 0 }), makeTab({ id: 2, visitCount: 0 })];
    expect(focusScore(tabs)).toBe(0);
  });
});

describe('topDistractor', () => {
  test('returns tab with highest visitCount', () => {
    const tabs = [
      makeTab({ id: 1, visitCount: 2 }),
      makeTab({ id: 2, visitCount: 10 }),
      makeTab({ id: 3, visitCount: 5 }),
    ];
    expect(topDistractor(tabs).id).toBe(2);
  });

  test('returns null when all tabs have visitCount 0', () => {
    const tabs = [makeTab({ id: 1, visitCount: 0 }), makeTab({ id: 2, visitCount: 0 })];
    expect(topDistractor(tabs)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(topDistractor([])).toBeNull();
  });
});

describe('oldestSurvivor', () => {
  test('returns tab with oldest openedAt', () => {
    const now = Date.now();
    const tabs = [
      makeTab({ id: 1, openedAt: now - 1000 }),
      makeTab({ id: 2, openedAt: now - 5000 }),
      makeTab({ id: 3, openedAt: now - 2000 }),
    ];
    expect(oldestSurvivor(tabs).id).toBe(2);
  });

  test('ignores tabs with null openedAt', () => {
    const now = Date.now();
    const tabs = [
      makeTab({ id: 1, openedAt: null }),
      makeTab({ id: 2, openedAt: now - 1000 }),
    ];
    expect(oldestSurvivor(tabs).id).toBe(2);
  });

  test('returns null when no tab has openedAt', () => {
    expect(oldestSurvivor([makeTab({ openedAt: null })])).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(oldestSurvivor([])).toBeNull();
  });
});

describe('domainObsession', () => {
  test('returns domain with highest total visitCount', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://github.com/a', visitCount: 5 }),
      makeTab({ id: 2, url: 'https://github.com/b', visitCount: 6 }),
      makeTab({ id: 3, url: 'https://google.com/a', visitCount: 10 }),
    ];
    expect(domainObsession(tabs)).toEqual({ domain: 'github.com', count: 11 });
  });

  test('picks the single highest domain', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://github.com/a', visitCount: 3 }),
      makeTab({ id: 2, url: 'https://google.com/a', visitCount: 10 }),
    ];
    expect(domainObsession(tabs)).toEqual({ domain: 'google.com', count: 10 });
  });

  test('returns null for empty tabs', () => {
    expect(domainObsession([])).toBeNull();
  });
});

describe('closedPerDay', () => {
  test('returns array of 5 day entries', () => {
    expect(closedPerDay([])).toHaveLength(5);
  });

  test('each entry has label and count properties', () => {
    closedPerDay([]).forEach(d => {
      expect(d).toHaveProperty('label');
      expect(d).toHaveProperty('count');
    });
  });

  test('counts entries falling on today (last slot)', () => {
    const now = Date.now();
    const log = [
      { ts: now - 100, domain: 'github.com' },
      { ts: now - 200, domain: 'google.com' },
    ];
    const result = closedPerDay(log);
    expect(result[4].count).toBe(2);
  });

  test('ignores entries older than 5 days', () => {
    const old = Date.now() - 6 * 24 * 60 * 60 * 1000;
    const result = closedPerDay([{ ts: old, domain: 'github.com' }]);
    expect(result.every(d => d.count === 0)).toBe(true);
  });
});

describe('staleTabs', () => {
  const NOW = 1700000000000;
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const THIRTY_MIN = 30 * 60 * 1000;

  test('includes tab open 4h with no recent visit', () => {
    const tab = makeTab({ id: 10, openedAt: NOW - FOUR_HOURS, lastVisitedAt: NOW - FOUR_HOURS });
    expect(staleTabs([tab], NOW)).toHaveLength(1);
  });

  test('excludes tab visited within 3 hours', () => {
    const tab = makeTab({ id: 11, openedAt: NOW - FOUR_HOURS, lastVisitedAt: NOW - TWO_HOURS });
    expect(staleTabs([tab], NOW)).toHaveLength(0);
  });

  test('excludes tab open less than 1 hour', () => {
    const tab = makeTab({ id: 12, openedAt: NOW - THIRTY_MIN, lastVisitedAt: null });
    expect(staleTabs([tab], NOW)).toHaveLength(0);
  });

  test('includes tab with null lastVisitedAt open 4h', () => {
    const tab = makeTab({ id: 13, openedAt: NOW - FOUR_HOURS, lastVisitedAt: null });
    expect(staleTabs([tab], NOW)).toHaveLength(1);
  });

  test('returns empty array for empty input', () => {
    expect(staleTabs([], NOW)).toHaveLength(0);
  });
});
