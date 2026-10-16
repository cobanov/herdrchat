import { render } from '@testing-library/react-native';

import { HostNotices } from '../HostNotices';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));

// Another host that fails is one line under the rows, never the list's error,
// and the whole sentence: the way out is at its end.
it('says each failed host in a line of its own, whole', async () => {
  const auth = "MacBook: The host refused the key. Add this phone's public key to ~/.ssh/authorized_keys on the host.";
  const screen = await render(<HostNotices notices={[
    { hostId: 'h-mac', label: 'MacBook', text: auth },
    { hostId: 'h-pi', label: 'Pi', text: 'Pi: Timed out.' },
  ]} />);
  expect(screen.getByTestId('host-notice-h-mac')).toHaveProp('accessibilityLabel', auth);
  expect(screen.getByText(auth)).not.toHaveProp('numberOfLines');
  expect(screen.getByTestId('host-notice-h-pi')).toHaveTextContent('Pi: Timed out.');
});

it('draws nothing when every host answered', async () => {
  const screen = await render(<HostNotices notices={[]} />);
  expect(screen.toJSON()).toBeNull();
});
