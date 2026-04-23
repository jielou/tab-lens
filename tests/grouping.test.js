const { suggestGroups } = require('../grouping');

const GROUP_COLORS = ['blue','red','yellow','green','pink','purple','cyan','orange'];

function makeTab(id, url, title, groupId = -1) {
  return { id, url, title, groupId };
}

describe('suggestGroups', () => {
  test('groups tabs by domain when 2+ share same root domain', () => {
    const tabs = [
      makeTab(1, 'https://github.com/user/repo1', 'Repo 1'),
      makeTab(2, 'https://github.com/user/repo2', 'Repo 2'),
      makeTab(3, 'https://google.com/search', 'Search'),
    ];
    const groups = suggestGroups(tabs);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupName).toBe('github.com');
    expect(groups[0].tabIds).toEqual([1, 2]);
  });

  test('skips already-grouped tabs', () => {
    const tabs = [
      makeTab(1, 'https://github.com/a', 'A', 5),
      makeTab(2, 'https://github.com/b', 'B'),
      makeTab(3, 'https://github.com/c', 'C'),
    ];
    const groups = suggestGroups(tabs);
    expect(groups[0].tabIds).toEqual([2, 3]);
  });

  test('skips internal chrome:// URLs', () => {
    const tabs = [
      makeTab(1, 'chrome://newtab', 'New Tab'),
      makeTab(2, 'chrome://settings', 'Settings'),
    ];
    const groups = suggestGroups(tabs);
    expect(groups).toHaveLength(0);
  });

  test('groups tabs by keyword when domains differ', () => {
    const tabs = [
      makeTab(1, 'https://docs.react.dev/', 'React Documentation'),
      makeTab(2, 'https://medium.com/react-hooks', 'React Hooks Guide'),
      makeTab(3, 'https://github.com/something', 'Something Else'),
    ];
    const groups = suggestGroups(tabs);
    const reactGroup = groups.find(g => g.groupName === 'react');
    expect(reactGroup).toBeDefined();
    expect(reactGroup.tabIds).toEqual([1, 2]);
  });

  test('domain clustering takes priority over keyword clustering', () => {
    const tabs = [
      makeTab(1, 'https://github.com/react/docs', 'React Docs'),
      makeTab(2, 'https://github.com/react/core', 'React Core'),
      makeTab(3, 'https://medium.com/react-guide', 'React Guide'),
    ];
    const groups = suggestGroups(tabs);
    const domainGroup = groups.find(g => g.groupName === 'github.com');
    expect(domainGroup.tabIds).toEqual([1, 2]);
    const keywordGroup = groups.find(g => g.groupName === 'react');
    expect(keywordGroup).toBeUndefined();
  });

  test('a tab only appears in one group', () => {
    const tabs = [
      makeTab(1, 'https://github.com/a', 'GitHub A'),
      makeTab(2, 'https://github.com/b', 'GitHub B'),
    ];
    const groups = suggestGroups(tabs);
    const allTabIds = groups.flatMap(g => g.tabIds);
    const unique = new Set(allTabIds);
    expect(unique.size).toBe(allTabIds.length);
  });

  test('returns color field on each group', () => {
    const tabs = [
      makeTab(1, 'https://github.com/a', 'A'),
      makeTab(2, 'https://github.com/b', 'B'),
    ];
    const groups = suggestGroups(tabs);
    expect(GROUP_COLORS).toContain(groups[0].color);
  });

  test('within keyword phase, a tab claimed by first keyword is not reused by second', () => {
    const tabs = [
      makeTab(1, 'https://site-a.com/page', 'JavaScript React Tutorial'),
      makeTab(2, 'https://site-b.com/page', 'JavaScript React Guide'),
      makeTab(3, 'https://site-c.com/page', 'React Only Page'),
    ];
    const groups = suggestGroups(tabs);
    const jsGroup = groups.find(g => g.groupName === 'javascript');
    expect(jsGroup).toBeDefined();
    expect(jsGroup.tabIds).toEqual([1, 2]);
    const reactGroup = groups.find(g => g.groupName === 'react');
    expect(reactGroup).toBeUndefined();
  });
});
