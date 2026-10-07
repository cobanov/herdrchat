import 'react-native-gesture-handler/jestSetup';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { showActionSheet } from '../ActionSheet';
import { Bubble } from '../Bubble';
import type { ChatMessage } from '@/lib/transcript/message';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../ActionSheet', () => ({ showActionSheet: jest.fn() }));

const TABLE = '| Option | Notes |\n|---|---|\n| SSH | Works wherever the port is open; the host key is pinned on first contact. |';

function message(role: 'user' | 'assistant', text: string): ChatMessage {
  return { id: `m-${role}`, role, segments: [{ kind: 'text', text }], timestamp: null, agentLabel: null, isSidechain: false };
}

beforeEach(() => jest.mocked(showActionSheet).mockClear());

// On iOS a scroll view will not scroll while a view above it is the JS
// responder. A Pressable around the bubble became the responder on every touch,
// so no table or code block in a message could be swiped sideways (build 83).
it.each(['assistant', 'user'] as const)('never makes a %s bubble the JS responder', async (role) => {
  await render(<Bubble message={message(role, TABLE)} />);
  const bubble = screen.getByTestId(`bubble-m-${role}`);
  expect(bubble.props.onStartShouldSetResponder).toBeUndefined();
  expect(bubble.props.onResponderGrant).toBeUndefined();
});

it('opens the copy sheet on a long press', async () => {
  await render(<Bubble message={message('assistant', TABLE)} />);
  await fireGestureHandler(getByGestureTestId('bubble-long-press-m-assistant'), [
    { state: State.BEGAN },
    { state: State.ACTIVE },
    { state: State.END },
  ]);
  expect(showActionSheet).toHaveBeenCalledWith(expect.objectContaining({ title: 'Agent message' }));
});

it('still offers copying to VoiceOver as an action', async () => {
  await render(<Bubble message={message('user', 'hello')} />);
  await fireEvent(screen.getByTestId('bubble-m-user'), 'accessibilityAction', {
    nativeEvent: { actionName: 'longpress' },
  });
  expect(showActionSheet).toHaveBeenCalledWith(expect.objectContaining({ title: 'Your message' }));
});
