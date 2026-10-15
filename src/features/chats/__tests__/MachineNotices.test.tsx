import { render } from '@testing-library/react-native';

import { MachineNotices } from '../MachineNotices';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));

// A machine that fails is one line under the rows, never the list's error,
// and the whole sentence: the way out is at its end.
it('says each failed machine in a line of its own, whole', async () => {
  const auth = "Gimel's ssh can't log in to klaw without a prompt. Give klaw a key file in Gimel's ~/.ssh/config (IdentityFile), not an agent that asks for approval.";
  const screen = await render(<MachineNotices notices={[
    { machineId: 'm-klaw', label: 'klaw', text: auth },
    { machineId: 'demo-nuku', label: 'nuku', text: "Demo can't reach nuku right now." },
  ]} />);
  expect(screen.getByTestId('machine-notice-m-klaw')).toHaveProp('accessibilityLabel', auth);
  expect(screen.getByText(auth)).not.toHaveProp('numberOfLines');
  expect(screen.getByTestId('machine-notice-demo-nuku')).toHaveTextContent("Demo can't reach nuku right now.");
});

it('draws nothing when every machine answered', async () => {
  const screen = await render(<MachineNotices notices={[]} />);
  expect(screen.toJSON()).toBeNull();
});
