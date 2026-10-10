import 'react-native-gesture-handler/jestSetup';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { showActionSheet } from '@/components/ActionSheet';
import type { ShellItem } from '@/lib/threadItems';
import { useToolRuns } from '@/state/toolRuns';
import { darkPalette, size } from '@/theme/tokens';
import { ShellRun } from '../ShellRun';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette }),
}));
jest.mock('@/components/ActionSheet', () => ({ showActionSheet: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

const shell = (extra: Partial<ShellItem> = {}): ShellItem => ({
  kind: 'shell', key: 'u1', command: 'git status --short', stdout: ' M a.ts\n?? b.ts', stderr: '', running: false, timestamp: 1, ...extra,
});

beforeEach(() => {
  jest.mocked(showActionSheet).mockClear();
  jest.mocked(Clipboard.setStringAsync).mockClear();
  useToolRuns.setState({ open: {} });
});

it('shows the command and what it printed', async () => {
  await render(<ShellRun item={shell()} timeLabel="14:27" />);
  expect(screen.getByTestId('shell-command')).toHaveTextContent('git status --short');
  expect(screen.getByTestId('shell-output')).toHaveTextContent(' M a.ts\n?? b.ts', { exact: true });
  expect(screen.getByText('14:27')).toBeTruthy();
  expect(screen.queryByTestId('shell-running')).toBeNull();
  expect(screen.queryByTestId('shell-show-all')).toBeNull();
});

it('runs until its output lands', async () => {
  await render(<ShellRun item={shell({ stdout: '', running: true })} timeLabel={null} />);
  expect(screen.getByTestId('shell-running')).toHaveTextContent('Running');
  expect(screen.queryByTestId('shell-output')).toBeNull();
  expect(screen.queryByTestId('shell-empty')).toBeNull();
});

it('says when a command printed nothing', async () => {
  await render(<ShellRun item={shell({ stdout: '' })} timeLabel={null} />);
  expect(screen.getByTestId('shell-empty')).toHaveTextContent('No output');
});

it('draws stderr after stdout in the attention colour', async () => {
  await render(<ShellRun item={shell({ stdout: 'ok', stderr: 'ls: /nope: No such file' })} timeLabel={null} />);
  const stderr = screen.getByTestId('shell-stderr');
  expect(stderr).toHaveTextContent('ls: /nope: No such file');
  expect(stderr).toHaveStyle({ color: darkPalette.attention });
});

it('folds long output and opens it on Show all', async () => {
  const lines = Array.from({ length: 200 }, (_, index) => String(index + 1));
  await render(<ShellRun item={shell({ command: 'seq 1 200', stdout: lines.join('\n') })} timeLabel={null} />);
  const output = () => String(screen.getByTestId('shell-output').props.children[0]);
  expect(output().split('\n')).toHaveLength(size.shellOutputLines);
  expect(screen.getByTestId('shell-show-all')).toHaveTextContent('Show all 200 lines');

  await act(async () => fireEvent.press(screen.getByTestId('shell-show-all')));
  expect(output().split('\n')).toHaveLength(200);
  expect(screen.getByTestId('shell-show-all')).toHaveTextContent('Show less');
});

it('copies the output or the command on a long press', async () => {
  await render(<ShellRun item={shell({ stdout: 'out', stderr: 'err' })} timeLabel={null} />);
  await fireGestureHandler(getByGestureTestId('shell-long-press-u1'), [
    { state: State.BEGAN },
    { state: State.ACTIVE },
    { state: State.END },
  ]);
  const sheet = jest.mocked(showActionSheet).mock.calls[0]?.[0];
  expect(sheet?.actions.map((action) => action.label)).toEqual(['Copy output', 'Copy command']);
  sheet?.actions[0]?.onPress();
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('out\nerr');
  sheet?.actions[1]?.onPress();
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('git status --short');
});

it('shows an output whose command is out of the window on its own', async () => {
  await render(<ShellRun item={shell({ command: null })} timeLabel={null} />);
  expect(screen.getByTestId('shell-command')).toHaveTextContent('Output');
});
