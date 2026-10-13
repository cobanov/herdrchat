import { fireEvent, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import { BlockedBar } from '../BlockedBar';
import { DEMO_BLOCKED_SCREEN } from '@/lib/demo/fixtures';
import { parseBlockedPrompt, type BlockedPrompt } from '@/lib/transcript/blockedPrompt';
import { size } from '@/theme/tokens';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@/lib/haptics', () => ({ haptics: { success: jest.fn() } }));

const Clipboard = jest.requireMock<{ setStringAsync: jest.Mock }>('expo-clipboard');

const bar = (prompt: BlockedPrompt) => render(<BlockedBar prompt={prompt} pending={null} onKeys={() => {}} />);

// "Do you want to proceed?" alone cannot be answered: the bar shows what runs.
describe('a prompt with details', () => {
  const prompt = parseBlockedPrompt(DEMO_BLOCKED_SCREEN);

  it('shows the tool, its description, the command, the warning and the deadline above the question', async () => {
    const screen = await bar(prompt);
    expect(screen.getByTestId('blocked-details-title')).toHaveTextContent('Bash command');
    expect(screen.getByText('Reproduce the empty-folder bug against an unreadable folder')).toBeTruthy();
    expect(screen.getByText(/chmod 000 \/tmp\/demo-unreadable &&/)).toBeTruthy();
    expect(screen.getByText('This command runs rm and could not be checked')).toBeTruthy();
    expect(screen.getByTestId('blocked-details-deadline')).toHaveTextContent('Auto-denies in 1:32');
    // Said once, on its own line, not again in the sentence it came from.
    expect(screen.queryByText(/automatically deny/)).toBeNull();
    expect(screen.getByText('Do you want to proceed?')).toBeTruthy();
    expect(screen.getByTestId('blocked-option-1')).toBeTruthy();
    expect(screen.queryByTestId('blocked-details-fold')).toBeNull();
  });

  // A long press copies the command, and only the command, to paste elsewhere.
  // The accessibility Copy action is the same path a screen reader takes.
  it('copies the command on long press', async () => {
    const screen = await bar(prompt);
    await fireEvent(screen.getByTestId('blocked-details-body'), 'accessibilityAction', {
      nativeEvent: { actionName: 'longpress' },
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      'mkdir -p /tmp/demo-unreadable && chmod 000 /tmp/demo-unreadable &&\n' +
        'npx jest src/lib/__tests__/directories.test.ts; rm -rf /tmp/demo-unreadable'
    );
  });

  it('folds a long body and opens it on request', async () => {
    const body = Array.from({ length: size.blockedBodyLines + 4 }, (_, index) => `step ${index}`);
    const details = { title: 'Bash command', summary: null, body, notes: [], deadline: null };
    const screen = await bar({ ...prompt, details });
    const last = `step ${body.length - 1}`;
    expect(screen.queryByText(new RegExp(last))).toBeNull();
    await fireEvent.press(screen.getByText(`Show all ${body.length} lines`));
    expect(screen.getByText(new RegExp(last))).toBeTruthy();
    expect(screen.getByText('Show less')).toBeTruthy();
  });
});

describe('a prompt without details', () => {
  it('shows only the question and its choices, as before', async () => {
    const screen = await bar({ question: 'Which database?', options: [{ number: 1, label: 'Postgres' }], details: null });
    expect(screen.queryByTestId('blocked-details')).toBeNull();
    expect(screen.getByText('Which database?')).toBeTruthy();
    expect(screen.getByText('Postgres')).toBeTruthy();
  });
});
