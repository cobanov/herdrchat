import { fireEvent, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import { DEMO_SESSION_IDS } from '@/lib/demo/fixtures';
import { demoHeadsUpStore } from '@/lib/demo/scenarios';
import { chatItems, parseHeadsUpFile } from '@/lib/headsup/items';
import { HeadsUpBar } from '../HeadsUpBar';
import { HeadsUpChatBar } from '../HeadsUpChatBar';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/lib/haptics', () => ({ haptics: { selection: jest.fn() } }));

/** The Demo's list, as the notes chat sets it up. */
const NOTES_SESSION = DEMO_SESSION_IDS['w2:p1']!;
const demoFile = () => parseHeadsUpFile(JSON.stringify(demoHeadsUpStore({ sessionId: NOTES_SESSION, folder: 'notes' }, Date.now())))!;

describe('the chats’ bar', () => {
  it('says what the mod’s band says, and opens the list', async () => {
    const onPress = jest.fn();
    const screen = await render(<HeadsUpBar items={demoFile().items} onPress={onPress} />);
    const bar = screen.getByTestId('headsup-bar');
    expect(bar.props.accessibilityLabel).toBe('⚑ 1 blocking · 5 need you · 2 questions · 1 follow-up · 1 failure · 1 note');
    expect(screen.getByText('⚑ 1 blocking · ')).toBeTruthy();
    await fireEvent.press(bar);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not there when nothing is open, as on a host without the mod', async () => {
    const done = demoFile().items.map((item) => ({ ...item, status: 'done' as const }));
    expect((await render(<HeadsUpBar items={done} onPress={() => {}} />)).queryByTestId('headsup-bar')).toBeNull();
    expect((await render(<HeadsUpBar items={[]} onPress={() => {}} />)).queryByTestId('headsup-bar')).toBeNull();
  });
});

describe('a chat’s bar', () => {
  const items = chatItems(demoFile().items, [NOTES_SESSION]);

  it('lists the chat’s own question first, then its follow-up, and Answer hands back the item', async () => {
    const onAnswer = jest.fn();
    const screen = await render(<HeadsUpChatBar items={items} onAnswer={onAnswer} onMore={() => {}} />);
    expect(items.map((item) => item.id)).toEqual(['demohu1q', 'demohu3f']);
    expect(screen.getByText('Question for you: ')).toBeTruthy();
    expect(screen.getByText('Follow-up: ')).toBeTruthy();
    // Not billing's question, nor the failure or the note.
    expect(screen.queryByText(/Round invoice/)).toBeNull();
    expect(screen.queryByText(/npm test/)).toBeNull();
    await fireEvent.press(screen.getByTestId('headsup-answer-demohu1q'));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: 'demohu1q' }));
    expect(screen.queryByTestId('headsup-chat-more')).toBeNull();
  });

  it('says how many more there are past what it shows', async () => {
    const onMore = jest.fn();
    const many = [...items, { ...items[1]!, id: 'x1' }, { ...items[1]!, id: 'x2' }];
    const screen = await render(<HeadsUpChatBar items={many} onAnswer={() => {}} onMore={onMore} />);
    expect(screen.getByText('2 more in Heads Up')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('headsup-chat-more'));
    expect(onMore).toHaveBeenCalled();
  });

  it('is not there with nothing for this chat', async () => {
    expect((await render(<HeadsUpChatBar items={[]} onAnswer={() => {}} onMore={() => {}} />)).queryByTestId('headsup-chat-bar')).toBeNull();
  });
});
