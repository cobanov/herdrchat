import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { View as MockView, type ViewProps } from 'react-native';

import { Composer } from '../Composer';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));

function Harness({ onSend }: { onSend: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  return <Composer onSend={onSend} draft={draft} onDraftChange={setDraft} />;
}

// #100: the draft was cleared even when the thread refused the message.
it('puts the draft back when the message was not taken', async () => {
  const onSend = jest.fn(async () => false);
  const screen = await render(<Harness onSend={onSend} />);
  await fireEvent.changeText(screen.getByTestId('composer-input'), 'keep this text');
  await fireEvent.press(screen.getByTestId('composer-send'));
  await act(async () => {});
  expect(onSend).toHaveBeenCalledWith('keep this text');
  expect(screen.getByTestId('composer-input').props.value).toBe('keep this text');
});

it('clears the draft when the message was taken', async () => {
  const screen = await render(<Harness onSend={async () => true} />);
  await fireEvent.changeText(screen.getByTestId('composer-input'), 'send this');
  await fireEvent.press(screen.getByTestId('composer-send'));
  await act(async () => {});
  expect(screen.getByTestId('composer-input').props.value).toBe('');
});
