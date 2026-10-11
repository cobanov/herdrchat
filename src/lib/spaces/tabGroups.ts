import type { Tab } from '../herdr/models';
import { tabNumber } from './layout';

/**
 * How the rows under a space card are split by tab. A workspace with two or
 * more tabs used to list its agents and then its shells in one run, so a
 * shell alone in a tab of its own read as if it sat beside the agents.
 */

/**
 * What a tab's group is headed by: its label when the person named it, null
 * when herdr only numbered it (an unnamed tab is labelled by its number, `1`)
 * or the label is empty. Such a tab gets the divider and no heading.
 */
export function tabHeading(tab: Pick<Tab, 'label' | 'number'>): string | null {
  const label = tab.label.trim();
  if (label === '' || label === String(tab.number)) return null;
  return label;
}

/** One tab's rows, in the order they came. */
export interface TabGroup<T> {
  tabId: string;
  /** `tabHeading` of the tab, null for an unnamed one or one herdr did not describe. */
  heading: string | null;
  rows: T[];
}

/**
 * `rows` split by the tab each sits in, tabs in their `number` order. A tab
 * the snapshot's `tabs` does not list (a herdr that sends none) is ordered by
 * the `:tN` suffix of its id, as the layout view does, and one without even
 * that after the rest, in the order its rows came. Within a tab the rows keep
 * their order. Only the tabs that hold a row are returned, so one group means
 * there is nothing to divide.
 */
export function groupByTab<T>(
  rows: readonly T[],
  tabIdOf: (row: T) => string,
  tabs: readonly Pick<Tab, 'tabId' | 'label' | 'number'>[]
): TabGroup<T>[] {
  const known = new Map(tabs.map((tab) => [tab.tabId, tab]));
  const groups = new Map<string, TabGroup<T> & { number: number }>();
  for (const row of rows) {
    const tabId = tabIdOf(row);
    let group = groups.get(tabId);
    if (group === undefined) {
      const tab = known.get(tabId);
      group = {
        tabId,
        heading: tab === undefined ? null : tabHeading(tab),
        number: tab?.number ?? tabNumber(tabId) ?? Number.POSITIVE_INFINITY,
        rows: [],
      };
      groups.set(tabId, group);
    }
    group.rows.push(row);
  }
  // `sort` is stable, so tabs of one number keep the order their rows came in.
  return [...groups.values()]
    .sort((a, b) => (a.number === b.number ? 0 : a.number < b.number ? -1 : 1))
    .map(({ tabId, heading, rows: grouped }) => ({ tabId, heading, rows: grouped }));
}
