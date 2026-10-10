import { fireEvent, render } from '@testing-library/react-native';

import { TerminalRow } from '../TerminalRow';
import type { ChatSummary } from '../useWorkspaces';
import type { Pane } from '@/lib/herdr/models';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));

const pane = { paneId: 'w6:p3', workspaceId: 'w6', tabId: 't1', agent: null, cwd: '/home/demo/api', foregroundCwd: '/home/demo/api/web', focused: false, title: null } as unknown as Pane;
const api: ChatSummary = {
  workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents: [], panes: [],
  preview: null, sessionSig: null, shellPanes: [], restoreError: null, sessionTitle: null, agentName: null,
};

it('names the program and the folder it is in, and opens on a tap', async () => {
  const press = jest.fn();
  const screen = await render(<TerminalRow summary={api} terminal={{ paneId: 'w6:p3', pane, processName: 'vim' }} onPress={press} />);
  expect(screen.getByText('Terminal')).toBeOnTheScreen();
  expect(screen.getByText('vim · api/web')).toBeOnTheScreen();
  const row = screen.getByTestId('terminal-row-w6:p3');
  expect(row.props.accessibilityLabel).toBe('Terminal in api, vim · api/web');
  await fireEvent.press(row);
  expect(press).toHaveBeenCalledTimes(1);
});

it('says Shell until herdr says which program, and names the machine for VoiceOver', async () => {
  const screen = await render(
    <TerminalRow
      summary={{ ...api, machine: { id: 'demo-nuku', label: 'nuku' } }}
      terminal={{ paneId: 'w6:p3', pane, processName: null }}
      onPress={jest.fn()}
    />
  );
  expect(screen.getByText('Shell · api/web')).toBeOnTheScreen();
  expect(screen.getByTestId('terminal-row-demo-nuku-w6:p3').props.accessibilityLabel).toBe('Terminal in api on nuku, Shell · api/web');
});
