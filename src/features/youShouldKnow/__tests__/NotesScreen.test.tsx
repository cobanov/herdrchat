import { act, fireEvent, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import { DEMO_SESSION_IDS } from '@/lib/demo/fixtures';
import { DEMO_YSK_ELSEWHERE, DEMO_YSK_PATH, demoYskStore } from '@/lib/demo/scenarios';
import { YSK_READ_INTERVAL_MS } from '@/lib/youShouldKnow/client';
import { parseYskFile, type NoteChat } from '@/lib/youShouldKnow/notes';
import { resetYouShouldKnowSession, useYouShouldKnow } from '@/state/youShouldKnow';
import NotesScreen from '../NotesScreen';

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
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
let mockOthers: { id: string; name: string }[] = [];
const mockTransports: Record<string, unknown> = { demo: { name: 'demo-transport' }, mac: { name: 'mac-transport' } };
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: 'demo', name: 'Demo' }),
  useConnections: (select: (state: { connections: { id: string; name: string }[] }) => unknown) =>
    select({ connections: [{ id: 'demo', name: 'Demo' }, ...mockOthers] }),
  resolveConnection: (id: string) => [{ id: 'demo', name: 'Demo' }, ...mockOthers].find((host) => host.id === id) ?? null,
  clientFor: (connection: { id: string }) => ({ transport: mockTransports[connection.id] }),
}));
let mockPolling = true;
jest.mock('@/features/usePollGate', () => ({ usePollGate: () => mockPolling }));
const mockCheck = jest.fn(async (..._args: unknown[]): Promise<void> => undefined);
jest.mock('@/state/youShouldKnow', () => ({
  ...jest.requireActual('@/state/youShouldKnow'),
  checkYouShouldKnow: (...args: unknown[]) => mockCheck(...args),
}));
jest.mock('@/features/chats/useHostChats', () => ({ useOtherHosts: () => mockOthers }));
const mockActions = {
  learnMoreAbout: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  knowAbout: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  dismissAbout: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  discussInChat: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  openLearningPage: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  goToNoteChat: jest.fn(),
};
jest.mock('../actions', () => ({
  learnMoreAbout: (...args: unknown[]) => mockActions.learnMoreAbout(...args),
  knowAbout: (...args: unknown[]) => mockActions.knowAbout(...args),
  dismissAbout: (...args: unknown[]) => mockActions.dismissAbout(...args),
  discussInChat: (...args: unknown[]) => mockActions.discussInChat(...args),
  openLearningPage: (...args: unknown[]) => mockActions.openLearningPage(...args),
  goToNoteChat: (...args: unknown[]) => mockActions.goToNoteChat(...args),
}));

const SESSION = DEMO_SESSION_IDS['w2:p1']!;
const CHAT: NoteChat = { sessionId: SESSION, workspaceId: 'w2', paneId: 'w2:p1', soleAgent: true, title: 'Release notes summary' };

function hold(connectionId: string, sessionId = SESSION, chats: NoteChat[] = [CHAT], change = (store: Record<string, unknown>): unknown => store) {
  useYouShouldKnow.getState().update(connectionId, () => ({
    path: DEMO_YSK_PATH,
    detectedAt: 1,
    version: '1 1',
    file: parseYskFile(JSON.stringify(change(demoYskStore(sessionId, Date.now())))),
    chats,
  }));
}

beforeEach(() => {
  resetYouShouldKnowSession();
  mockOthers = [];
  mockPolling = true;
  mockCheck.mockReset();
  mockCheck.mockResolvedValue(undefined);
  jest.useRealTimers();
  for (const action of Object.values(mockActions)) action.mockClear();
});

it('lists the notes newest first, each from its chat or another session', async () => {
  hold('demo');
  const screen = await render(<NotesScreen />);
  expect(screen.getByTestId('ysk-summary')).toHaveTextContent('2 notes for you');
  expect(screen.getAllByTestId(/^ysk-row-/).map((node) => node.props.testID)).toEqual([`ysk-row-${SESSION}`, `ysk-row-${DEMO_YSK_ELSEWHERE}`]);
  expect(screen.getByTestId(`ysk-from-${SESSION}`)).toHaveTextContent(/^Release notes summary · Today, /);
  expect(screen.getByTestId(`ysk-from-${DEMO_YSK_ELSEWHERE}`)).toHaveTextContent(/^another session on Demo · Today, /);
});

it('offers the chat’s Heads up Learn more, Knew this already, Discuss in chat, Dismiss and Go', async () => {
  hold('demo');
  const screen = await render(<NotesScreen />);
  for (const name of ['learn-more', 'knew', 'discuss', 'dismiss', 'go']) expect(screen.getByTestId(`ysk-${name}-${SESSION}`)).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`ysk-go-${SESSION}`));
  expect(mockActions.goToNoteChat).toHaveBeenCalledWith('demo', CHAT);
  await act(async () => { fireEvent.press(screen.getByTestId(`ysk-discuss-${SESSION}`)); });
  expect(mockActions.discussInChat).toHaveBeenCalledWith('demo', expect.objectContaining({ sessionId: SESSION }), CHAT);
  await act(async () => { fireEvent.press(screen.getByTestId(`ysk-learn-more-${SESSION}`)); });
  expect(mockActions.learnMoreAbout).toHaveBeenCalledWith('demo', expect.objectContaining({ sessionId: SESSION }));
});

it('shows another session’s explained note with Understood and Dismiss only', async () => {
  hold('demo');
  const screen = await render(<NotesScreen />);
  expect(screen.getByTestId(`ysk-explanation-${DEMO_YSK_ELSEWHERE}`)).toHaveTextContent(/Rounding per line adds up/);
  expect(screen.getByTestId(`ysk-understood-${DEMO_YSK_ELSEWHERE}`)).toBeTruthy();
  expect(screen.getByTestId(`ysk-dismiss-${DEMO_YSK_ELSEWHERE}`)).toBeTruthy();
  for (const name of ['learn-more', 'knew', 'discuss', 'go']) expect(screen.queryByTestId(`ysk-${name}-${DEMO_YSK_ELSEWHERE}`)).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId(`ysk-understood-${DEMO_YSK_ELSEWHERE}`)); });
  expect(mockActions.knowAbout).toHaveBeenCalledWith('demo', expect.objectContaining({ sessionId: DEMO_YSK_ELSEWHERE }));
});

it('names the host with several, and says when an action did not happen', async () => {
  hold('demo');
  hold('mac', '44444444-4444-4444-8444-444444444444', []);
  mockOthers = [{ id: 'mac', name: 'Gimel' }];
  mockActions.dismissAbout.mockResolvedValueOnce("Couldn't update the note on Demo. Check that it's awake, then try again.");
  const screen = await render(<NotesScreen />);
  expect(screen.getByTestId('ysk-summary')).toHaveTextContent('4 notes for you');
  expect(screen.getByTestId(`ysk-from-${SESSION}`)).toHaveTextContent(/^Release notes summary · Demo · /);
  await act(async () => { fireEvent.press(screen.getByTestId(`ysk-dismiss-${SESSION}`)); });
  expect(screen.getByText(/Couldn't update the note on Demo/)).toBeTruthy();
});

it('says there are none', async () => {
  const screen = await render(<NotesScreen />);
  expect(screen.getByTestId('ysk-summary')).toHaveTextContent('No notes for you.');
  expect(screen.queryAllByTestId(/^ysk-row-/)).toHaveLength(0);
});

it('offers another session’s offer only Knew this already and Dismiss, even with an explanation', async () => {
  // The demo chat's own offer, but with no chat listed for its session.
  hold('demo', SESSION, []);
  const screen = await render(<NotesScreen />);
  expect(screen.getByTestId(`ysk-from-${SESSION}`)).toHaveTextContent(/^another session on Demo · /);
  expect(screen.getByTestId(`ysk-knew-${SESSION}`)).toBeTruthy();
  expect(screen.getByTestId(`ysk-dismiss-${SESSION}`)).toBeTruthy();
  for (const name of ['learn-more', 'discuss', 'go']) expect(screen.queryByTestId(`ysk-${name}-${SESSION}`)).toBeNull();
});

it('reads every listed host’s store while open, and only while on top', async () => {
  jest.useFakeTimers();
  hold('demo');
  mockOthers = [{ id: 'mac', name: 'Gimel' }];
  const screen = await render(<NotesScreen />);
  expect(mockCheck.mock.calls).toEqual([['demo', mockTransports.demo], ['mac', mockTransports.mac]]);
  await act(async () => { jest.advanceTimersByTime(YSK_READ_INTERVAL_MS); });
  expect(mockCheck).toHaveBeenCalledTimes(4);
  mockPolling = false;
  await screen.rerender(<NotesScreen />);
  await act(async () => { jest.advanceTimersByTime(YSK_READ_INTERVAL_MS * 3); });
  expect(mockCheck).toHaveBeenCalledTimes(4);
});

it('drops a note answered at the computer while the screen is open', async () => {
  jest.useFakeTimers();
  hold('demo');
  const screen = await render(<NotesScreen />);
  expect(screen.getByTestId(`ysk-row-${SESSION}`)).toBeTruthy();
  // At the computer: Knew this already on the chat's note.
  mockCheck.mockImplementation(async () => {
    hold('demo', SESSION, [CHAT], (store) => ({
      ...store,
      sessions: (store.sessions as { id: string }[]).map((row) => (row.id === SESSION ? { ...row, view: undefined } : row)),
    }));
  });
  await act(async () => { jest.advanceTimersByTime(YSK_READ_INTERVAL_MS); });
  expect(screen.queryByTestId(`ysk-row-${SESSION}`)).toBeNull();
  expect(screen.getByTestId('ysk-summary')).toHaveTextContent('1 note for you');
});
