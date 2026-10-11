import { agentName, type AgentInfo, type AgentStatus, type Tab, type TabLayout } from '../herdr/models';
import { processLabel, type TerminalPane } from '../terminal/rows';

/**
 * What a workspace's layout view draws: every tab, in herdr's order, with
 * its panes as boxes where they sit on the desktop. Pure, so the geometry and
 * the words are pinned by tests rather than only by a picture.
 *
 * The input is shaped like a chat summary (`ChatSummary` satisfies it), kept
 * structural so this file needs nothing from the feature that lists it.
 */
export interface SpaceLayoutInput {
  workspaceId: string;
  tabs: readonly Tab[];
  layouts: readonly TabLayout[];
  activeTabId: string | null;
  /** The conversational agents, with the status their rows show (`blocked` while a menu waits). */
  panes: readonly { paneId: string; agent: AgentInfo; status: AgentStatus; sessionTitle: string | null; agentName: string | null }[];
  /** Every other pane: what its terminal row says it runs. */
  shellPanes: readonly TerminalPane[];
}

export type LayoutPaneKind = 'agent' | 'shell';

/** One pane's box, in a unit square over its tab's area (0 to 1 both ways). */
export interface LayoutPane {
  paneId: string;
  kind: LayoutPaneKind;
  /**
   * "Claude" for an agent; for a shell, the program in front or its title,
   * else "Shell": the word its terminal row shows (`processLabel`), so one
   * pane is not "Shell" in the list and "shell" in its layout.
   */
  label: string;
  /** An agent's session title (or herdr name), which the box shows under its label. */
  detail: string | null;
  /** The agent's kind (`claude`), for its colour; null for a shell. */
  agent: string | null;
  /** The agent's status; null for a shell, which has none worth showing. */
  status: AgentStatus | null;
  /** The pane the tab's focus is in. */
  focused: boolean;
  /** The tab is zoomed on this pane: it is drawn alone, full size. */
  zoomed: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutTab {
  tabId: string;
  number: number;
  /** herdr's label, else "Tab N". */
  title: string;
  /** The tab the workspace shows. */
  active: boolean;
  /** Zoomed on one pane: `panes` is that pane alone, filling the tab. */
  zoomed: boolean;
  /** The tab's area in cells, so a drawing can keep its proportions (cells are taller than wide). */
  columns: number;
  rows: number;
  /** How many panes the tab holds, zoomed or not. */
  paneCount: number;
  panes: LayoutPane[];
}

/**
 * Each tab of the workspace: the snapshot's tabs, plus any tab only its
 * layout names (a herdr that sends layouts but no `tabs`), ordered by number.
 * A tab with no layout has no boxes; its title still says it is there.
 */
export function spaceLayoutModel(input: SpaceLayoutInput): LayoutTab[] {
  const layoutOf = new Map(input.layouts.map((layout) => [layout.tabId, layout]));
  const known = new Set(input.tabs.map((tab) => tab.tabId));
  const tabs: { tabId: string; number: number; label: string }[] = [
    ...input.tabs.map((tab) => ({ tabId: tab.tabId, number: tab.number, label: tab.label })),
    ...input.layouts
      .filter((layout) => !known.has(layout.tabId))
      .map((layout, index) => ({ tabId: layout.tabId, number: tabNumber(layout.tabId) ?? input.tabs.length + index + 1, label: '' })),
  ].sort((a, b) => a.number - b.number);

  return tabs.map((tab) => {
    const layout = layoutOf.get(tab.tabId);
    const boxes = layout?.panes ?? [];
    const area = union(boxes.map((box) => box.rect));
    const zoomedOn = layout?.zoomed === true
      ? boxes.find((box) => box.paneId === layout.focusedPaneId) ?? boxes.find((box) => box.focused) ?? null
      : null;
    const shown = zoomedOn === null ? boxes : [zoomedOn];
    const panes = shown.map((box): LayoutPane => {
      const focused = box.focused || layout?.focusedPaneId === box.paneId;
      const place = zoomedOn !== null
        ? { x: 0, y: 0, width: 1, height: 1 }
        : {
          x: area.width > 0 ? (box.rect.x - area.x) / area.width : 0,
          y: area.height > 0 ? (box.rect.y - area.y) / area.height : 0,
          width: area.width > 0 ? box.rect.width / area.width : 1,
          height: area.height > 0 ? box.rect.height / area.height : 1,
        };
      return { paneId: box.paneId, ...describe(input, box.paneId), focused, zoomed: zoomedOn !== null, ...place };
    });
    return {
      tabId: tab.tabId,
      number: tab.number,
      title: tab.label.trim() !== '' ? tab.label.trim() : `Tab ${tab.number}`,
      active: input.activeTabId === tab.tabId,
      zoomed: zoomedOn !== null,
      columns: area.width,
      rows: area.height,
      paneCount: boxes.length,
      panes,
    };
  });
}

/** What a pane's box says: an agent by its provider and session, anything else by what runs there. */
function describe(input: SpaceLayoutInput, paneId: string): Pick<LayoutPane, 'kind' | 'label' | 'detail' | 'agent' | 'status'> {
  const agent = input.panes.find((pane) => pane.paneId === paneId);
  if (agent !== undefined) {
    return {
      kind: 'agent',
      label: agentName(agent.agent.agent),
      detail: agent.sessionTitle ?? agent.agentName,
      agent: agent.agent.agent,
      status: agent.status,
    };
  }
  const shell = input.shellPanes.find((pane) => pane.paneId === paneId);
  return {
    kind: 'shell',
    label: shell === undefined ? processLabel({ agent: null, title: null }, null) : processLabel(shell.pane, shell.processName),
    detail: null,
    agent: null,
    status: null,
  };
}

/** The smallest rectangle around every pane: a tab's area need not start at 0 (herdr's sidebar). */
function union(rects: readonly { x: number; y: number; width: number; height: number }[]) {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** `w6:t2` → 2: herdr's tab ids end in their number, which orders a tab herdr sent no `tabs` row for. */
function tabNumber(tabId: string): number | null {
  const match = /:t(\d+)$/.exec(tabId);
  return match === null ? null : Number(match[1]);
}

/** How a layout view names a tab and its panes to VoiceOver: `api, active tab, 3 panes`. */
export function tabAccessibilityLabel(tab: LayoutTab): string {
  return [
    tab.title,
    tab.active ? 'active tab' : '',
    tab.zoomed ? `zoomed on one of ${tab.paneCount} panes` : `${tab.paneCount} ${tab.paneCount === 1 ? 'pane' : 'panes'}`,
  ].filter(Boolean).join(', ');
}

/** A pane's box to VoiceOver: `Claude, Save button wrap, working, focused`. */
export function paneAccessibilityLabel(pane: LayoutPane): string {
  return [
    pane.kind === 'shell' ? `Terminal, ${pane.label}` : pane.label,
    pane.detail ?? '',
    pane.status === null ? '' : pane.status === 'blocked' ? 'needs you' : pane.status === 'working' ? 'working' : '',
    pane.focused ? 'focused' : '',
    pane.zoomed ? 'zoomed' : '',
  ].filter(Boolean).join(', ');
}
