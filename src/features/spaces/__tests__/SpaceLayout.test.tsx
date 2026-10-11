import { fireEvent, render } from '@testing-library/react-native';
import { View as MockView } from 'react-native';

import { buildSummaries } from '@/features/chats/useWorkspaces';
import { listChats, type ListedChat } from '@/features/chats/listedChat';
import { HerdrClient } from '@/lib/herdr/client';
import { DemoHost } from '@/lib/demo/host';
import { SpaceLayout } from '../SpaceLayout';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/features/usePollGate', () => ({ usePollGate: () => true }));
jest.mock('@/features/useHostEvents', () => ({ useHostEvents: () => false }));
jest.mock('@/state/settings', () => ({ useSettings: () => 1 }));
jest.mock('@/state/hostTheme', () => ({ checkHostTheme: async () => true }));
jest.mock('@/state/hostMachines', () => ({ refreshHostMachines: async () => true }));
jest.mock('@/state/slashCommands', () => ({ scanSlashCatalogue: async () => undefined }));

const mockOpenChat = jest.fn();
const mockOpenTerminal = jest.fn();
jest.mock('@/features/chats/navigation', () => ({ openChat: (...args: unknown[]) => mockOpenChat(...args) }));
jest.mock('@/features/terminal/navigation', () => ({ openTerminal: (...args: unknown[]) => mockOpenTerminal(...args) }));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, avatarPalette: jest.requireActual('@/theme/tokens').avatarPalette }),
}));
jest.mock('@/components/Icon', () => ({ Icon: ({ name }: { name: string }) => <MockView testID={`icon-${name}`} /> }));

/** The Demo's workspaces, as the list holds them. */
async function demo(): Promise<ListedChat[]> {
  const snapshot = await new HerdrClient(new DemoHost()).snapshot();
  return listChats(buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes, new Map(), snapshot), 'demo', null);
}

async function drawn(summary: ListedChat, onClose = jest.fn()) {
  const screen = await render(<SpaceLayout summary={summary} onClose={onClose} />);
  // The tabs are sized to the width the view is given.
  await fireEvent(screen.getByTestId(`layout-${summary.workspaceId}`), 'layout', { nativeEvent: { layout: { width: 320, height: 200 } } });
  return screen;
}

beforeEach(() => {
  mockOpenChat.mockClear();
  mockOpenTerminal.mockClear();
});

it("draws each of w6's tabs with its panes as boxes", async () => {
  const w6 = (await demo()).find((summary) => summary.workspaceId === 'w6')!;
  const screen = await drawn(w6);
  expect(screen.getByTestId('layout-tab-w6:t1')).toBeOnTheScreen();
  expect(screen.getByTestId('layout-tab-w6:t2')).toBeOnTheScreen();
  for (const paneId of ['w6:p1', 'w6:p2', 'w6:p3', 'w6:p4']) expect(screen.getByTestId(`layout-pane-${paneId}`)).toBeOnTheScreen();
  expect(screen.getByText('api')).toBeOnTheScreen();
  expect(screen.getByText('server')).toBeOnTheScreen();
  expect(screen.getByText('Save button wrap')).toBeOnTheScreen();
  expect(screen.getByText('npm run dev')).toBeOnTheScreen();
  // Side by side in the first tab, the shell under the first agent.
  const left = (id: string) => (screen.getByTestId(`layout-pane-${id}`).props.style as { left: number }).left;
  const top = (id: string) => (screen.getByTestId(`layout-pane-${id}`).props.style as { top: number }).top;
  expect(left('w6:p2')).toBeGreaterThan(left('w6:p1'));
  expect(top('w6:p3')).toBeGreaterThan(top('w6:p1'));
});

it("opens an agent's box as its chat, after closing the view", async () => {
  const onClose = jest.fn();
  const w6 = (await demo()).find((summary) => summary.workspaceId === 'w6')!;
  const screen = await drawn(w6, onClose);
  await fireEvent.press(screen.getByTestId('layout-pane-w6:p2'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockOpenChat).toHaveBeenCalledWith('demo', 'w6', 'Save button wrap', 'w6:p2');
  expect(mockOpenTerminal).not.toHaveBeenCalled();
});

it("opens a shell's box as its terminal, by its terminal id", async () => {
  const onClose = jest.fn();
  const w6 = (await demo()).find((summary) => summary.workspaceId === 'w6')!;
  const screen = await drawn(w6, onClose);
  await fireEvent.press(screen.getByTestId('layout-pane-w6:p3'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockOpenTerminal).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'demo', paneId: 'w6:p3', kind: 'shell', terminalId: 'term_w6_p3' }));
  expect(mockOpenChat).not.toHaveBeenCalled();
});

// One agent beside a shell is the workspace chat, as its card used to open
// it and as its row in Agents does.
it('opens the one agent of a workspace as the workspace chat', async () => {
  const w6 = (await demo()).find((summary) => summary.workspaceId === 'w6')!;
  const solo: ListedChat = { ...w6, panes: w6.panes.slice(0, 1) };
  const screen = await drawn(solo);
  await fireEvent.press(screen.getByTestId('layout-pane-w6:p1'));
  expect(mockOpenChat).toHaveBeenCalledWith('demo', 'w6', 'Archived projects migration', undefined);
});

it('says so when herdr reports no layout', async () => {
  const w6 = (await demo()).find((summary) => summary.workspaceId === 'w6')!;
  const screen = await render(<SpaceLayout summary={{ ...w6, tabs: [], layouts: [] }} onClose={jest.fn()} />);
  expect(screen.getByTestId('layout-empty')).toBeOnTheScreen();
});

// A tab zoomed on one pane is drawn as that pane alone, with the zoom mark.
it('draws a zoomed tab as its focused pane alone, marked', async () => {
  const w6 = (await demo()).find((summary) => summary.workspaceId === 'w6')!;
  const zoomed: ListedChat = { ...w6, layouts: w6.layouts.map((layout) => layout.tabId === 'w6:t1' ? { ...layout, zoomed: true } : layout) };
  const screen = await drawn(zoomed);
  expect(screen.getByTestId('layout-pane-w6:p2')).toBeOnTheScreen();
  expect(screen.queryByTestId('layout-pane-w6:p1')).toBeNull();
  expect(screen.queryByTestId('layout-pane-w6:p3')).toBeNull();
  expect(screen.getAllByTestId('icon-arrow.up.left.and.arrow.down.right')).toHaveLength(1);
  // The other tab is drawn as before, unmarked.
  expect(screen.getByTestId('layout-pane-w6:p4')).toBeOnTheScreen();
});
