import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { View as MockView, type ViewProps } from 'react-native';

import { Composer } from '../Composer';
import { SETTINGS_DEFAULTS, useSettings } from '@/state/settings';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
// The key-command container passes its callbacks through, so a test can press
// the hardware keys the way the native side reports them.
jest.mock('../../../../modules/herdr-keys/src', () => ({
  SubmitShortcutView: (props: ViewProps) => <MockView testID="composer-keys" {...props} />,
}));

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

// A long draft and the keyboard can cover the whole chat.
it('offers to hide the keyboard while typing, and keeps the draft', async () => {
  const { Keyboard } = jest.requireActual<typeof import('react-native')>('react-native');
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  const screen = await render(<Harness onSend={async () => true} />);
  expect(screen.queryByTestId('composer-hide-keyboard')).toBeNull();
  await fireEvent(screen.getByTestId('composer-input'), 'focus');
  await fireEvent.changeText(screen.getByTestId('composer-input'), 'a long prompt');
  await fireEvent.press(screen.getByTestId('composer-hide-keyboard'));
  expect(dismiss).toHaveBeenCalled();
  expect(screen.getByTestId('composer-input').props.value).toBe('a long prompt');
});

// #155: Return sends only from a hardware keyboard. The software keyboard's
// Return is the field's own newline; the hardware keys are key commands
// (HerdrKeysModule.swift) that reach `returnAction` through these callbacks.
describe('Return', () => {
  // In act: the composer from the test is still mounted and reads the setting.
  afterEach(async () => {
    await act(async () => useSettings.getState().hydrate(SETTINGS_DEFAULTS));
  });

  const keys = (screen: Awaited<ReturnType<typeof render>>) => screen.getByTestId('composer-keys').props as {
    onSubmitShortcut: () => void;
    onReturnShortcut?: () => void;
    onNewlineShortcut?: (modifiers: { shift: boolean; option: boolean }) => void;
  };

  it.each([true, false])('leaves the field\'s own Return a newline with the setting %s', async (returnSends) => {
    useSettings.getState().set('returnSends', returnSends);
    const onSend = jest.fn(async () => true);
    const screen = await render(<Harness onSend={onSend} />);
    const field = screen.getByTestId('composer-input');
    expect(field.props.submitBehavior).toBe('newline');
    expect(field.props.returnKeyType).toBe('default');
    await fireEvent.changeText(field, 'half a prompt');
    await fireEvent(field, 'submitEditing');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-input').props.value).toBe('half a prompt');
  });

  it('sends on a hardware Return', async () => {
    const onSend = jest.fn(async () => true);
    const screen = await render(<Harness onSend={onSend} />);
    await fireEvent.changeText(screen.getByTestId('composer-input'), 'go');
    await act(async () => keys(screen).onReturnShortcut?.());
    expect(onSend).toHaveBeenCalledWith('go');
  });

  it.each([
    [{ shift: true, option: false }],
    [{ shift: false, option: true }],
  ])('starts a new line on %o', async (modifiers) => {
    const onSend = jest.fn(async () => true);
    const screen = await render(<Harness onSend={onSend} />);
    const field = screen.getByTestId('composer-input');
    await fireEvent.changeText(field, 'one');
    await fireEvent(field, 'selectionChange', { nativeEvent: { selection: { start: 3, end: 3 } } });
    await act(async () => keys(screen).onNewlineShortcut?.(modifiers));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-input').props.value).toBe('one\n');
  });

  it('takes no hardware Return, Shift-Return or Option-Return with the setting off; Command-Return still sends', async () => {
    useSettings.getState().set('returnSends', false);
    const onSend = jest.fn(async () => true);
    const screen = await render(<Harness onSend={onSend} />);
    expect(keys(screen).onReturnShortcut).toBeUndefined();
    expect(keys(screen).onNewlineShortcut).toBeUndefined();
    await fireEvent.changeText(screen.getByTestId('composer-input'), 'go');
    await act(async () => keys(screen).onSubmitShortcut());
    expect(onSend).toHaveBeenCalledWith('go');
  });
});
