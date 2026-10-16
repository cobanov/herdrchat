import { fireEvent, render } from '@testing-library/react-native';
import { View as MockView } from 'react-native';

import { buildSummaries } from '@/features/chats/useWorkspaces';
import { listChats, type ListedChat } from '@/features/chats/listedChat';
import { HerdrClient } from '@/lib/herdr/client';
import { DemoHost } from '@/lib/demo/host';
import { useSpaceLayoutSheet } from '@/state/spaceLayout';
import SpaceLayoutSheet from '../SpaceLayoutSheet';
import { usePendingPaneOpen } from '../usePendingPaneOpen';

// What happened, in order: the sheet going back, and a pane opening.
const mockCalls: string[] = [];
let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: () => mockCalls.push('back') }),
  // The root's focus, fired by hand: `mockFocus()` is the sheet having gone.
  useFocusEffect: (effect: () => void) => {
    mockFocus = effect;
  },
}));
jest.mock('@/features/usePollGate', () => ({ usePollGate: () => true }));
jest.mock('@/features/useHostEvents', () => ({ useHostEvents: () => false }));
jest.mock('@/state/settings', () => ({ useSettings: () => 1 }));
jest.mock('@/state/hostTheme', () => ({ checkHostTheme: async () => true }));
jest.mock('@/state/slashCommands', () => ({ scanSlashCatalogue: async () => undefined }));
jest.mock('@/features/chats/navigation', () => ({
  openChat: (_connection: string, _workspace: string, _title: string, paneId?: string) => mockCalls.push(`chat ${paneId ?? ''}`),
}));
jest.mock('@/features/terminal/navigation', () => ({
  openTerminal: (params: { paneId: string }) => mockCalls.push(`terminal ${params.paneId}`),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, avatarPalette: jest.requireActual('@/theme/tokens').avatarPalette }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => <MockView /> }));

async function w6(): Promise<ListedChat> {
  const snapshot = await new HerdrClient(new DemoHost()).snapshot();
  const listed = listChats(buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes, new Map(), snapshot), 'demo', null);
  return listed.find((summary) => summary.workspaceId === 'w6')!;
}

/** The chats root, as far as the hand back goes. */
function Root() {
  usePendingPaneOpen();
  return null;
}

async function sheet() {
  useSpaceLayoutSheet.getState().show(await w6());
  const view = await render(<><Root /><SpaceLayoutSheet /></>);
  await fireEvent(view.getByTestId('layout-w6'), 'layout', { nativeEvent: { layout: { width: 300, height: 200 } } });
  return view;
}

beforeEach(() => {
  mockCalls.length = 0;
  mockFocus = null;
});

// The sheet never navigates after its own `back()`: it records the pane and
// closes, and the root opens it once it has focus again.
it('hands a box back to the root, which opens it on its next focus', async () => {
  const view = await sheet();
  await fireEvent.press(view.getByTestId('layout-pane-w6:p3'));
  expect(mockCalls).toEqual(['back']);
  expect(useSpaceLayoutSheet.getState().pending).toEqual(expect.objectContaining({ kind: 'terminal' }));
  mockFocus?.();
  expect(mockCalls).toEqual(['back', 'terminal w6:p3']);
  expect(useSpaceLayoutSheet.getState().pending).toBeNull();
  // A later focus of the root (another sheet closing) opens nothing again.
  mockFocus?.();
  expect(mockCalls).toEqual(['back', 'terminal w6:p3']);
});

it("opens an agent's box as its chat, the same way", async () => {
  const view = await sheet();
  await fireEvent.press(view.getByTestId('layout-pane-w6:p1'));
  mockFocus?.();
  expect(mockCalls).toEqual(['back', 'chat w6:p1']);
});

it('opens nothing when the sheet is closed without a box', async () => {
  const view = await sheet();
  await fireEvent.press(view.getByTestId('space-layout-close'));
  mockFocus?.();
  expect(mockCalls).toEqual(['back']);
});

// A pane asked for and never opened (the root never refocused) does not
// leak into the next sheet.
it('starts a new sheet with nothing pending', async () => {
  useSpaceLayoutSheet.getState().request({ kind: 'chat', connectionId: 'demo', workspaceId: 'w6', title: 'x', paneId: undefined });
  await sheet();
  mockFocus?.();
  expect(mockCalls).toEqual([]);
});

it("lets a box's first tap through with the keyboard up", async () => {
  const view = await sheet();
  expect(view.getByTestId('space-layout-sheet')).toHaveProp('keyboardShouldPersistTaps', 'handled');
});

