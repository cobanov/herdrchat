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
jest.mock('@/state/hostMachines', () => ({ refreshHostMachines: async () => true }));
jest.mock('@/state/slashCommands', () => ({ scanSlashCatalogue: async () => undefined }));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, avatarPalette: jest.requireActual('@/theme/tokens').avatarPalette }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
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

async function drawn(peek: Peek | null, summary: ListedChat | null) {
  const handlers = { onClose: jest.fn(), onPin: jest.fn(), onHoverCard: jest.fn() };
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

it('pins a hovered card when it is tapped, and offers no backdrop or Esc before that', async () => {
  const { view, onPin } = await drawn(peekOf(false), await w6());
  expect(view.queryByTestId('space-layout-backdrop')).toBeNull();
  expect(view.getByTestId('escape-key')).toHaveProp('active', false);
  await fireEvent.press(view.getByTestId('space-layout-card'));
  expect(onPin).toHaveBeenCalledTimes(1);
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
