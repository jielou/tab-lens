const { buildRecoveryPool, consumeRecovery } = require('../src/recovery');

describe('buildRecoveryPool', () => {
  test('returns empty pool for empty input', () => {
    expect(buildRecoveryPool({})).toEqual({});
    expect(buildRecoveryPool(null)).toEqual({});
    expect(buildRecoveryPool(undefined)).toEqual({});
  });

  test('indexes a single entry by URL', () => {
    const oldTimestamps = {
      42: { url: 'https://github.com/a', openedAt: 1000, lastVisitedAt: 2000, visitCount: 3 },
    };
    const pool = buildRecoveryPool(oldTimestamps);
    expect(pool).toEqual({
      'https://github.com/a': [{ openedAt: 1000, lastVisitedAt: 2000, visitCount: 3 }],
    });
  });

  test('indexes multiple distinct URLs separately', () => {
    const oldTimestamps = {
      1: { url: 'https://a.com/', openedAt: 100, lastVisitedAt: 200, visitCount: 0 },
      2: { url: 'https://b.com/', openedAt: 300, lastVisitedAt: 400, visitCount: 5 },
    };
    const pool = buildRecoveryPool(oldTimestamps);
    expect(Object.keys(pool).sort()).toEqual(['https://a.com/', 'https://b.com/']);
    expect(pool['https://a.com/']).toHaveLength(1);
    expect(pool['https://b.com/']).toHaveLength(1);
  });

  test('groups multiple entries with the same URL into a bucket sorted oldest-first', () => {
    const oldTimestamps = {
      1: { url: 'https://x.com/', openedAt: 3000, lastVisitedAt: 3000, visitCount: 1 },
      2: { url: 'https://x.com/', openedAt: 1000, lastVisitedAt: 2000, visitCount: 7 },
      3: { url: 'https://x.com/', openedAt: 2000, lastVisitedAt: 2500, visitCount: 2 },
    };
    const pool = buildRecoveryPool(oldTimestamps);
    expect(pool['https://x.com/'].map(e => e.openedAt)).toEqual([1000, 2000, 3000]);
  });

  test('skips entries without a URL', () => {
    const oldTimestamps = {
      1: { url: '', openedAt: 1, lastVisitedAt: 1, visitCount: 0 },
      2: { openedAt: 2, lastVisitedAt: 2, visitCount: 0 },
      3: { url: 'https://ok.com/', openedAt: 3, lastVisitedAt: 3, visitCount: 0 },
    };
    const pool = buildRecoveryPool(oldTimestamps);
    expect(Object.keys(pool)).toEqual(['https://ok.com/']);
  });

  test('defaults missing visitCount to 0', () => {
    const pool = buildRecoveryPool({
      1: { url: 'https://a.com/', openedAt: 1, lastVisitedAt: 1 },
    });
    expect(pool['https://a.com/'][0].visitCount).toBe(0);
  });
});

describe('consumeRecovery', () => {
  test('returns null for empty or missing pool', () => {
    expect(consumeRecovery({}, 'https://a.com/')).toBeNull();
    expect(consumeRecovery(null, 'https://a.com/')).toBeNull();
    expect(consumeRecovery(undefined, 'https://a.com/')).toBeNull();
  });

  test('returns null when URL has no bucket', () => {
    const pool = { 'https://a.com/': [{ openedAt: 1, lastVisitedAt: 1, visitCount: 0 }] };
    expect(consumeRecovery(pool, 'https://b.com/')).toBeNull();
    // Pool unchanged
    expect(pool['https://a.com/']).toHaveLength(1);
  });

  test('returns null for missing URL', () => {
    const pool = { 'https://a.com/': [{ openedAt: 1, lastVisitedAt: 1, visitCount: 0 }] };
    expect(consumeRecovery(pool, '')).toBeNull();
    expect(consumeRecovery(pool, null)).toBeNull();
    expect(consumeRecovery(pool, undefined)).toBeNull();
  });

  test('pops the only entry and removes the bucket', () => {
    const pool = {
      'https://a.com/': [{ openedAt: 1, lastVisitedAt: 2, visitCount: 3 }],
    };
    const entry = consumeRecovery(pool, 'https://a.com/');
    expect(entry).toEqual({ openedAt: 1, lastVisitedAt: 2, visitCount: 3 });
    expect(pool['https://a.com/']).toBeUndefined();
  });

  test('pops oldest-openedAt entry first when bucket has duplicates', () => {
    const pool = buildRecoveryPool({
      1: { url: 'https://x.com/', openedAt: 3000, lastVisitedAt: 3000, visitCount: 1 },
      2: { url: 'https://x.com/', openedAt: 1000, lastVisitedAt: 2000, visitCount: 7 },
      3: { url: 'https://x.com/', openedAt: 2000, lastVisitedAt: 2500, visitCount: 2 },
    });
    expect(consumeRecovery(pool, 'https://x.com/').openedAt).toBe(1000);
    expect(consumeRecovery(pool, 'https://x.com/').openedAt).toBe(2000);
    expect(consumeRecovery(pool, 'https://x.com/').openedAt).toBe(3000);
    expect(consumeRecovery(pool, 'https://x.com/')).toBeNull();
  });
});
