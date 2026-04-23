const { extractDomain, formatAge, mergeTabsWithTimestamps } = require('../tabData');

describe('extractDomain', () => {
  test('extracts root domain from full URL', () => {
    expect(extractDomain('https://github.com/user/repo')).toBe('github.com');
  });

  test('extracts root domain with subdomain', () => {
    expect(extractDomain('https://docs.google.com/doc/123')).toBe('google.com');
  });

  test('returns empty string for chrome:// URL', () => {
    expect(extractDomain('chrome://newtab')).toBe('');
  });

  test('returns empty string for null URL', () => {
    expect(extractDomain(null)).toBe('');
  });
});

describe('formatAge', () => {
  const NOW = 1000000000000;

  test('returns "unknown" for null timestamp', () => {
    expect(formatAge(null, NOW)).toBe('unknown');
  });

  test('formats seconds ago', () => {
    expect(formatAge(NOW - 30000, NOW)).toBe('30s ago');
  });

  test('formats minutes ago', () => {
    expect(formatAge(NOW - 5 * 60 * 1000, NOW)).toBe('5m ago');
  });

  test('formats hours ago', () => {
    expect(formatAge(NOW - 3 * 60 * 60 * 1000, NOW)).toBe('3h ago');
  });

  test('formats days ago', () => {
    expect(formatAge(NOW - 2 * 24 * 60 * 60 * 1000, NOW)).toBe('2d ago');
  });
});

describe('mergeTabsWithTimestamps', () => {
  test('merges timestamps into tab objects', () => {
    const tabs = [{ id: 1, title: 'Test', url: 'https://example.com' }];
    const timestamps = { 1: { openedAt: 1000, lastVisitedAt: 2000 } };
    const result = mergeTabsWithTimestamps(tabs, timestamps);
    expect(result[0].openedAt).toBe(1000);
    expect(result[0].lastVisitedAt).toBe(2000);
  });

  test('sets null timestamps for tabs without records', () => {
    const tabs = [{ id: 2, title: 'Test', url: 'https://example.com' }];
    const timestamps = {};
    const result = mergeTabsWithTimestamps(tabs, timestamps);
    expect(result[0].openedAt).toBeNull();
    expect(result[0].lastVisitedAt).toBeNull();
  });
});
