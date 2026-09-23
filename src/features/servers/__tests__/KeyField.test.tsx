import { fireEvent, render } from '@testing-library/react-native';

import { KeyField, describeKey } from '../KeyField';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette }),
}));

const KEY = ['-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAA', 'AAAAAAAA', '-----END OPENSSH PRIVATE KEY-----'].join('\n');

// The key stayed on screen in full, and in every screenshot of the form (#4).
it('shows an entered key only while it is being edited', async () => {
  const onChangeText = jest.fn();
  const screen = await render(<KeyField value={KEY} onChangeText={onChangeText} />);
  expect(screen.getByTestId('field-secret-summary')).toHaveTextContent(/OpenSSH private key, 4 lines/);
  expect(screen.queryByText(/b3BlbnNzaC1rZXkt/)).toBeNull();
  await fireEvent.press(screen.getByTestId('field-secret-summary'));
  expect(onChangeText).toHaveBeenCalledWith('');
});

it('is an ordinary field while empty', async () => {
  const screen = await render(<KeyField value="" onChangeText={jest.fn()} />);
  expect(screen.getByTestId('field-secret')).toBeOnTheScreen();
});

it('names the kind of key without its content', () => {
  expect(describeKey('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----')).toBe('RSA private key, 3 lines');
  expect(describeKey('not a key')).toBe('Key text, 1 line');
});
