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

describe('pictures', () => {
  const picture = { name: 'mf2x9a1k-3kd81zq0.jpg', uri: 'file:///attachments/mf2x9a1k-3kd81zq0.jpg' };

  it('sends a message that is only pictures', async () => {
    const onSend = jest.fn(async () => true);
    const screen = await render(
      <Composer onSend={onSend} draft="" onDraftChange={() => {}} attachments={[picture]} onAttach={() => {}} />
    );
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(onSend).toHaveBeenCalledWith('');
  });

  it('offers a picture, and takes one away', async () => {
    const onAttach = jest.fn();
    const onRemove = jest.fn();
    const screen = await render(
      <Composer onSend={async () => true} draft="" onDraftChange={() => {}} attachments={[picture]}
        onAttach={onAttach} onRemoveAttachment={onRemove} />
    );
    await fireEvent.press(screen.getByTestId('composer-attach'));
    await fireEvent.press(screen.getByTestId('composer-attachment-remove-0'));
    expect(onAttach).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledWith(picture.name);
  });

  it('holds the send while the pictures upload', async () => {
    const onSend = jest.fn(async () => true);
    const screen = await render(
      <Composer onSend={onSend} draft="caption" onDraftChange={() => {}} attachments={[picture]} uploading />
    );
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-send').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('has no picture button where pictures cannot be sent', async () => {
    const screen = await render(<Composer onSend={async () => true} draft="" onDraftChange={() => {}} />);
    expect(screen.queryByTestId('composer-attach')).toBeNull();
  });
});
