import { act, fireEvent, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import { DEMO_SESSION_IDS } from '@/lib/demo/fixtures';
import { DEMO_YSK_LINE, demoYskStore } from '@/lib/demo/scenarios';
import { noteDraft } from '@/lib/youShouldKnow/draft';
import { parseYskFile, type Note } from '@/lib/youShouldKnow/notes';
import { ChatNoteBar } from '../ChatNoteBar';
import { NotesBar } from '../NotesBar';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/lib/haptics', () => ({ haptics: { selection: jest.fn() } }));
const mockActions = {
  learnMoreAbout: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  knowAbout: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  dismissAbout: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  openLearningPage: jest.fn(async (..._args: unknown[]): Promise<string | null> => null),
  discussHere: jest.fn(async (_connectionId: string, note: Note, fill: (draft: string) => void): Promise<string | null> => {
    fill(jest.requireActual('@/lib/youShouldKnow/draft').noteDraft(note));
    return null;
  }),
};
jest.mock('../actions', () => ({
  discussHere: (connectionId: string, note: Note, fill: (draft: string) => void) => mockActions.discussHere(connectionId, note, fill),
  learnMoreAbout: (...args: unknown[]) => mockActions.learnMoreAbout(...args),
  knowAbout: (...args: unknown[]) => mockActions.knowAbout(...args),
  dismissAbout: (...args: unknown[]) => mockActions.dismissAbout(...args),
  openLearningPage: (...args: unknown[]) => mockActions.openLearningPage(...args),
}));

const SESSION = DEMO_SESSION_IDS['w2:p1']!;
const T = Date.parse('2026-10-24T12:00:00Z');
const notes = () => parseYskFile(JSON.stringify(demoYskStore(SESSION, T)))!.notes;
const offer = () => notes()[0]!;
const explained = () => notes()[1]!;

beforeEach(() => {
  for (const action of Object.values(mockActions)) action.mockClear();
});

describe('the chats’ bar', () => {
  it('shows one note as the terminal does, and opens the notes', async () => {
    const onPress = jest.fn();
    const screen = await render(<NotesBar notes={[offer()]} onPress={onPress} />);
    const bar = screen.getByTestId('ysk-bar');
    expect(bar.props.accessibilityLabel).toBe(`✦ Heads up · ${DEMO_YSK_LINE}`);
    expect(screen.getByText('Heads up · ')).toBeTruthy();
    await fireEvent.press(bar);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('says how many there are when there are several', async () => {
    const screen = await render(<NotesBar notes={notes()} onPress={() => {}} />);
    expect(screen.getByTestId('ysk-bar').props.accessibilityLabel).toBe('✦ 2 notes for you');
    expect(screen.getByText('✦ 2 notes for you')).toBeTruthy();
  });

  it('is not there with no notes, as on a host without the plugin', async () => {
    expect((await render(<NotesBar notes={[]} onPress={() => {}} />)).queryByTestId('ysk-bar')).toBeNull();
  });
});

describe('a chat’s bar', () => {
  it('offers Learn more, Knew this already, Discuss in chat and Dismiss, with no Go', async () => {
    const screen = await render(<ChatNoteBar connectionId="demo" note={offer()} onDraft={() => {}} />);
    for (const name of ['learn-more', 'knew', 'discuss', 'dismiss']) expect(screen.getByTestId(`ysk-chat-${name}-${SESSION}`)).toBeTruthy();
    expect(screen.queryByTestId(`ysk-chat-go-${SESSION}`)).toBeNull();
    // An offer keeps its explanation for Learn more.
    expect(screen.queryByTestId(`ysk-chat-explanation-${SESSION}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`ysk-chat-learn-more-${SESSION}`));
    expect(mockActions.learnMoreAbout).toHaveBeenCalledWith('demo', offer());
  });

  it('offers no Learn more for an offer without its explanation', async () => {
    const bare: Note = { ...offer(), view: { kind: 'offer', line: 'A line.', explanation: null, shownAt: 1 } };
    const screen = await render(<ChatNoteBar connectionId="demo" note={bare} onDraft={() => {}} />);
    expect(screen.queryByTestId(`ysk-chat-learn-more-${SESSION}`)).toBeNull();
    expect(screen.getByTestId(`ysk-chat-knew-${SESSION}`)).toBeTruthy();
  });

  it('shows an explained note’s explanation, with Understood', async () => {
    const note = { ...explained(), sessionId: SESSION };
    const screen = await render(<ChatNoteBar connectionId="demo" note={note} onDraft={() => {}} />);
    expect(screen.getByTestId(`ysk-chat-explanation-${SESSION}`)).toHaveTextContent(/Rounding per line adds up/);
    expect(screen.queryByTestId(`ysk-chat-knew-${SESSION}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`ysk-chat-understood-${SESSION}`));
    expect(mockActions.knowAbout).toHaveBeenCalledWith('demo', note);
  });

  it('Discuss in chat hands the draft to the composer and lets the note go', async () => {
    const onDraft = jest.fn();
    const screen = await render(<ChatNoteBar connectionId="demo" note={offer()} onDraft={onDraft} />);
    await act(async () => { fireEvent.press(screen.getByTestId(`ysk-chat-discuss-${SESSION}`)); });
    expect(mockActions.discussHere).toHaveBeenCalledWith('demo', offer(), onDraft);
    expect(onDraft).toHaveBeenCalledWith(noteDraft(offer()));
  });

  it('says when it could not', async () => {
    mockActions.dismissAbout.mockResolvedValueOnce("Couldn't update the note on Demo. Check that it's awake, then try again.");
    const screen = await render(<ChatNoteBar connectionId="demo" note={offer()} onDraft={() => {}} />);
    await act(async () => { fireEvent.press(screen.getByTestId(`ysk-chat-dismiss-${SESSION}`)); });
    expect(screen.getByTestId('ysk-chat-error')).toHaveTextContent(/Couldn't update the note on Demo/);
  });

  it('opens a learning page, with only Dismiss beside it', async () => {
    const ready: Note = { ...offer(), view: { kind: 'ready', line: 'A line.', url: 'https://claude.ai/artifact/abc', shownAt: 1 } };
    const screen = await render(<ChatNoteBar connectionId="demo" note={ready} onDraft={() => {}} />);
    expect(screen.getByText(/Learning page ready/)).toBeTruthy();
    expect(screen.queryByTestId(`ysk-chat-discuss-${SESSION}`)).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId(`ysk-chat-page-${SESSION}`)); });
    expect(mockActions.openLearningPage).toHaveBeenCalledWith('https://claude.ai/artifact/abc');
    expect(screen.getByTestId(`ysk-chat-dismiss-${SESSION}`)).toBeTruthy();
  });
});
