import type { Tab } from '../herdr/models';
import { groupByTab, tabHeading } from '../spaces/tabGroups';

const tab = (tabId: string, number: number, label: string): Pick<Tab, 'tabId' | 'number' | 'label'> => ({ tabId, number, label });

describe('tabHeading', () => {
  it('is the label the person gave the tab', () => {
    expect(tabHeading(tab('w1:t2', 2, 'server'))).toBe('server');
    expect(tabHeading(tab('w1:t2', 2, '  server '))).toBe('server');
  });

  // herdr labels a tab nobody named with its number.
  it('is null for an empty label, whitespace, or just the number', () => {
    expect(tabHeading(tab('w1:t1', 1, ''))).toBeNull();
    expect(tabHeading(tab('w1:t1', 1, '   '))).toBeNull();
    expect(tabHeading(tab('w1:t3', 3, '3'))).toBeNull();
    expect(tabHeading(tab('w1:t3', 3, ' 3 '))).toBeNull();
    // Another tab's number is a name, though an odd one.
    expect(tabHeading(tab('w1:t3', 3, '12'))).toBe('12');
  });
});

describe('groupByTab', () => {
  const rows = [
    { id: 'a', tabId: 'w1:t2' },
    { id: 'b', tabId: 'w1:t1' },
    { id: 'c', tabId: 'w1:t2' },
    { id: 'd', tabId: 'w1:t10' },
  ];
  const shape = (groups: ReturnType<typeof groupByTab<{ id: string; tabId: string }>>) =>
    groups.map((group) => `${group.tabId}${group.heading === null ? '' : ` "${group.heading}"`}: ${group.rows.map((row) => row.id).join(',')}`);

  it('orders tabs by number, keeping each tab\'s rows in order', () => {
    const tabs = [tab('w1:t10', 3, 'logs'), tab('w1:t1', 1, 'api'), tab('w1:t2', 2, '2')];
    expect(shape(groupByTab(rows, (row) => row.tabId, tabs))).toEqual(['w1:t1 "api": b', 'w1:t2: a,c', 'w1:t10 "logs": d']);
  });

  // A herdr with no `tabs`: by the number at the end of the id, no headings.
  it('falls back to the tab id\'s number', () => {
    expect(shape(groupByTab(rows, (row) => row.tabId, []))).toEqual(['w1:t1: b', 'w1:t2: a,c', 'w1:t10: d']);
  });

  it('puts a tab with no number after the rest, in the order it came', () => {
    const odd = [{ id: 'x', tabId: 'mystery' }, ...rows, { id: 'y', tabId: 'other' }];
    expect(shape(groupByTab(odd, (row) => row.tabId, [])).map((line) => line.split(':')[0])).toEqual(['w1', 'w1', 'w1', 'mystery', 'other']);
  });

  it('returns only the tabs that hold a row', () => {
    expect(groupByTab([{ id: 'a', tabId: 'w1:t2' }], (row) => row.tabId, [tab('w1:t1', 1, 'api'), tab('w1:t2', 2, 'web')])).toHaveLength(1);
    expect(groupByTab([], (row: { tabId: string }) => row.tabId, [])).toEqual([]);
  });
});
