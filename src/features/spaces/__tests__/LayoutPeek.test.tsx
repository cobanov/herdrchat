import { fireEvent, render } from '@testing-library/react-native';
import { Dimensions, View as MockView, type ViewProps } from 'react-native';

import { buildSummaries } from '@/features/chats/useWorkspaces';
import { listChats, type ListedChat } from '@/features/chats/listedChat';
import { HerdrClient } from '@/lib/herdr/client';
import { DemoHost } from '@/lib/demo/host';
import type { Peek } from '@/lib/spaces/peek';
import { LayoutPeekOverlay } from '../LayoutPeek';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/features/usePollGate', () => ({ usePollGate: () => true }));
jest.mock('@/features/useHostEvents', () => ({ useHostEvents: () => false }));
jest.mock('@/state/settings', () => ({ useSettings: () => 1 }));
jest.mock('@/state/hostTheme', () => ({ checkHostTheme: async () => true }));
jest.mock('@/state/slashCommands', () => ({ scanSlashCatalogue: async () => undefined }));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, avatarPalette: jest.requireActual('@/theme/tokens').avatarPalette }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
// What happened, in order: the card closing and the pane opening.
const mockCalls: string[] = [];
jest.mock('@/features/chats/navigation', () => ({
  openChat: (_connection: string, _workspace: string, _title: string, paneId?: string) => mockCalls.push(`chat ${paneId ?? ''}`),
}));
jest.mock('@/features/terminal/navigation', () => ({
  openTerminal: (params: { paneId: string }) => mockCalls.push(`terminal ${params.paneId}`),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
// The native Esc view, as a plain view that keeps its props, so Esc can be pressed.
jest.mock('../../../../modules/herdr-keys/src/escape', () => ({
  EscapeKeyView: (props: ViewProps & { active: boolean; onEscape: () => void }) => <MockView testID="escape-key" {...props} />,
}));

async function w6(): Promise<ListedChat> {
  const snapshot = await new HerdrClient(new DemoHost()).snapshot();
  const listed = listChats(buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes, new Map(), snapshot), 'demo', null);
  return listed.find((summary) => summary.workspaceId === 'w6')!;
}

function peekOf(pinned: boolean): Peek {
  const { width, height } = Dimensions.get('window');
  return {
    key: 'w6', pinned, overButton: !pinned, overCard: false,
    anchor: { x: 260, y: 200, width: 44, height: 44 },
    column: { x: 0, y: 0, width: 320, height },
    window: { x: 0, y: 0, width, height },
  };
}

beforeEach(() => {
  mockCalls.length = 0;
});

async function drawn(peek: Peek | null, summary: ListedChat | null) {
  const handlers = { onClose: jest.fn(() => mockCalls.push('close')), onPin: jest.fn(), onHoverCard: jest.fn() };
  const view = await render(<LayoutPeekOverlay column={{ current: null }} peek={peek} summary={summary} {...handlers} />);
  return { view, ...handlers };
}

it('closes a pinned card on a tap outside it, and on Esc', async () => {
  const { view, onClose } = await drawn(peekOf(true), await w6());
  expect(view.getByTestId('space-layout-card')).toBeOnTheScreen();
  expect(view.getByTestId('escape-key')).toHaveProp('active', true);
  await fireEvent.press(view.getByTestId('space-layout-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
  (view.getByTestId('escape-key').props as { onEscape: () => void }).onEscape();
  expect(onClose).toHaveBeenCalledTimes(2);
});

// Pinned as a finger or a click lands, not when it lifts: a box under it is
// the responder for its own tap, and a click ends the hover that was holding
// an unpinned card up.
it('pins a hovered card as a touch lands on it, and offers no backdrop or Esc before that', async () => {
  const { view, onPin } = await drawn(peekOf(false), await w6());
  expect(view.queryByTestId('space-layout-backdrop')).toBeNull();
  expect(view.getByTestId('escape-key')).toHaveProp('active', false);
  await fireEvent(view.getByTestId('space-layout-card'), 'touchStart');
  expect(onPin).toHaveBeenCalledTimes(1);
});

it('does not pin a pinned card again', async () => {
  const { view, onPin } = await drawn(peekOf(true), await w6());
  await fireEvent(view.getByTestId('space-layout-card'), 'touchStart');
  expect(onPin).not.toHaveBeenCalled();
});

// A box closes the card, then opens its pane: the shell's terminal, an
// agent's chat. The card's own pin is not what answers the tap.
it.each([true, false])('closes the card and then opens the pane a box stands for (pinned: %s)', async (pinned) => {
  const { view, onClose } = await drawn(peekOf(pinned), await w6());
  await fireEvent(view.getByTestId('layout-w6'), 'layout', { nativeEvent: { layout: { width: 300, height: 200 } } });
  await fireEvent.press(view.getByTestId('layout-pane-w6:p3'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockCalls).toEqual(['close', 'terminal w6:p3']);
  mockCalls.length = 0;
  await fireEvent.press(view.getByTestId('layout-pane-w6:p2'));
  expect(mockCalls).toEqual(['close', 'chat w6:p2']);
});

// With a field focused (the composer beside the list), a ScrollView's
// default spends the first tap dismissing the keyboard and the box never
// hears it.
it("lets a box's first tap through with the keyboard up", async () => {
  const { view } = await drawn(peekOf(false), await w6());
  expect(view.getByTestId('space-layout-card-scroll')).toHaveProp('keyboardShouldPersistTaps', 'handled');
});

it('says when the pointer is on the card, and when it has gone after a beat', async () => {
  jest.useFakeTimers();
  try {
    const { view, onHoverCard } = await drawn(peekOf(false), await w6());
    const card = view.getByTestId('space-layout-card').parent!;
    await fireEvent(card, 'pointerEnter');
    expect(onHoverCard).toHaveBeenLastCalledWith(true);
    await fireEvent(card, 'pointerLeave');
    expect(onHoverCard).toHaveBeenCalledTimes(1);
    jest.runAllTimers();
    expect(onHoverCard).toHaveBeenLastCalledWith(false);
  } finally {
    jest.useRealTimers();
  }
});

it('draws nothing once the workspace has left the list', async () => {
  const { view } = await drawn(peekOf(true), null);
  expect(view.queryByTestId('space-layout-card')).toBeNull();
  expect(view.queryByTestId('space-layout-backdrop')).toBeNull();
});

// Measured in a window of another size: its place means nothing now.
it('draws nothing after the window changed size', async () => {
  const peek = peekOf(true);
  const { view } = await drawn({ ...peek, window: { ...peek.window, width: peek.window.width + 100 } }, await w6());
  expect(view.queryByTestId('space-layout-card')).toBeNull();
});
