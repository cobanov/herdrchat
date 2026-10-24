import { act, fireEvent, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import { DEMO_SESSION_IDS } from '@/lib/demo/fixtures';
import { DEMO_HEADSUP_PATH, demoHeadsUpStore } from '@/lib/demo/scenarios';
import { parseHeadsUpFile, type HeadsUpChat } from '@/lib/headsup/items';
import { resetHeadsUpSession, useHeadsUp } from '@/state/headsUp';
import HeadsUpScreen from '../HeadsUpScreen';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/components/Header', () => ({ Header: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/lib/haptics', () => ({ haptics: { selection: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
let mockOthers: { id: string; name: string }[] = [];
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: 'demo', name: 'Demo' }),
  useConnections: (select: (state: { connections: { id: string; name: string }[] }) => unknown) =>
    select({ connections: [{ id: 'demo', name: 'Demo' }, ...mockOthers] }),
}));
jest.mock('@/features/chats/useHostChats', () => ({ useOtherHosts: () => mockOthers }));
const mockActions = {
  resolveHeadsUpItem: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  reopenHeadsUpItem: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  replyToHeadsUpItem: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  goToHeadsUpChat: jest.fn(),
};
jest.mock('../actions', () => ({
  resolveHeadsUpItem: (...args: unknown[]) => mockActions.resolveHeadsUpItem(...args),
  reopenHeadsUpItem: (...args: unknown[]) => mockActions.reopenHeadsUpItem(...args),
  replyToHeadsUpItem: (...args: unknown[]) => mockActions.replyToHeadsUpItem(...args),
  goToHeadsUpChat: (...args: unknown[]) => mockActions.goToHeadsUpChat(...args),
}));

const NOTES_SESSION = DEMO_SESSION_IDS['w2:p1']!;
const NOTES_CHAT: HeadsUpChat = { sessionId: NOTES_SESSION, workspaceId: 'w2', paneId: 'w2:p1', soleAgent: true };

function hold(connectionId: string, tweak: (raw: Record<string, unknown>) => Record<string, unknown> = (raw) => raw) {
  const raw = tweak(demoHeadsUpStore({ sessionId: NOTES_SESSION, folder: 'notes' }, Date.now()));
  useHeadsUp.getState().update(connectionId, () => ({
    path: DEMO_HEADSUP_PATH,
    detectedAt: 1,
    version: '1 1',
    file: parseHeadsUpFile(JSON.stringify(raw)),
    chats: [NOTES_CHAT],
  }));
}

beforeEach(() => {
  resetHeadsUpSession();
  mockParams = {};
  mockOthers = [];
  for (const action of Object.values(mockActions)) action.mockClear();
});

it('groups the items as the mod does: questions, follow-ups, failures, notes, the blocking question first', async () => {
  hold('demo');
  const screen = await render(<HeadsUpScreen />);
  expect(screen.getByTestId('headsup-summary')).toHaveTextContent('2 questions · 1 follow-up · 1 failure · 1 note');
  expect(screen.getAllByTestId(/^headsup-group-/).map((node) => node.props.testID)).toEqual([
    'headsup-group-question', 'headsup-group-followup', 'headsup-group-failure', 'headsup-group-note',
  ]);
  expect(screen.getAllByTestId(/^headsup-item-/).map((node) => node.props.testID)).toEqual([
    'headsup-item-demohu1q', 'headsup-item-demohu2q', 'headsup-item-demohu3f', 'headsup-item-demohu4x', 'headsup-item-demohu5n',
  ]);
  // The kind this app does not know is not drawn.
  expect(screen.queryByText(/newer mod/)).toBeNull();
});

it('offers Reply and Go for the chat’s own question, and only ✓ for one whose session is not running here', async () => {
  hold('demo');
  const screen = await render(<HeadsUpScreen />);
  expect(screen.getByTestId('headsup-reply-demohu1q')).toBeTruthy();
  expect(screen.getByTestId('headsup-go-demohu1q')).toBeTruthy();
  expect(screen.queryByTestId('headsup-reply-demohu2q')).toBeNull();
  expect(screen.queryByTestId('headsup-go-demohu2q')).toBeNull();
  expect(screen.getByTestId('headsup-unreachable-demohu2q')).toHaveTextContent(/That session isn't running here/);
  expect(screen.getByTestId('headsup-done-demohu2q')).toBeTruthy();
  expect(screen.getByText(/Today, .* · from billing$/)).toBeTruthy();
  expect(screen.getByText(/The export rounds per line/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('headsup-go-demohu1q'));
  expect(mockActions.goToHeadsUpChat).toHaveBeenCalledWith('demo', NOTES_CHAT);
});

it('leaves out "from" for the chat it was opened from, and names the host with several', async () => {
  hold('demo');
  mockParams = { from: NOTES_SESSION };
  const screen = await render(<HeadsUpScreen />);
  expect(screen.queryAllByText(/from notes/)).toHaveLength(0);
  expect(screen.getAllByText(/from billing/)).toHaveLength(1);
  await screen.unmount();

  mockParams = {};
  mockOthers = [{ id: 'mac', name: 'Gimel' }];
  const several = await render(<HeadsUpScreen />);
  expect(several.getAllByText(/ · Demo$/).length).toBeGreaterThan(0);
});

it('ticks off a note, closes a failure, and says when it could not', async () => {
  hold('demo');
  const screen = await render(<HeadsUpScreen />);
  await fireEvent.press(screen.getByTestId('headsup-done-demohu5n'));
  expect(mockActions.resolveHeadsUpItem).toHaveBeenLastCalledWith('demo', expect.objectContaining({ id: 'demohu5n' }));
  mockActions.resolveHeadsUpItem.mockResolvedValueOnce("Couldn't update Heads Up on Demo. Check that it's awake, then try again.");
  await fireEvent.press(screen.getByTestId('headsup-close-demohu4x'));
  expect(mockActions.resolveHeadsUpItem).toHaveBeenLastCalledWith('demo', expect.objectContaining({ id: 'demohu4x' }));
  expect(screen.getByText(/Couldn't update Heads Up on Demo/)).toBeTruthy();
});

it('replies through a field, sending to the chat that asked', async () => {
  hold('demo');
  const screen = await render(<HeadsUpScreen />);
  await fireEvent.press(screen.getByTestId('headsup-reply-demohu1q'));
  await fireEvent.changeText(screen.getByTestId('headsup-reply-field-demohu1q'), 'Keep it as a draft');
  await act(async () => { fireEvent.press(screen.getByTestId('headsup-send-demohu1q')); });
  expect(mockActions.replyToHeadsUpItem).toHaveBeenCalledWith('demo', expect.objectContaining({ id: 'demohu1q' }), NOTES_CHAT, 'Keep it as a draft');
  expect(screen.queryByTestId('headsup-reply-field-demohu1q')).toBeNull();
});

it('shows a reply sent as waiting for Claude, with Reply again', async () => {
  hold('demo', (raw) => ({ ...raw, items: (raw.items as Record<string, unknown>[]).map((item) => (item.id === 'demohu1q' ? { ...item, repliedAt: 5 } : item)) }));
  const screen = await render(<HeadsUpScreen />);
  expect(screen.getByTestId('headsup-replied-demohu1q')).toHaveTextContent('Reply sent, waiting for Claude.');
  expect(screen.queryByTestId('headsup-reply-demohu1q')).toBeNull();
  await fireEvent.press(screen.getByTestId('headsup-reply-again-demohu1q'));
  expect(mockActions.reopenHeadsUpItem).toHaveBeenCalledWith('demo', expect.objectContaining({ id: 'demohu1q' }));
});

it('shows done items only when asked, and nothing needs you when all are done', async () => {
  hold('demo', (raw) => ({ ...raw, items: (raw.items as Record<string, unknown>[]).map((item) => ({ ...item, status: 'done', doneAt: 5 })) }));
  const screen = await render(<HeadsUpScreen />);
  expect(screen.getByTestId('headsup-summary')).toHaveTextContent('Nothing needs you.');
  expect(screen.queryAllByTestId(/^headsup-item-/)).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('headsup-show-done'));
  expect(screen.getAllByTestId(/^headsup-item-/)).toHaveLength(5);
  expect(screen.getByText('✓ Check the March numbers with finance')).toBeTruthy();
  expect(screen.queryByTestId('headsup-done-demohu5n')).toBeNull();
});
