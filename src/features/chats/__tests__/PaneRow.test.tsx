import { fireEvent, render } from '@testing-library/react-native';

import { PaneRow } from '../PaneRow';
import type { AgentInfo } from '@/lib/herdr/models';
import type { ChatSummary, PaneSummary } from '../useWorkspaces';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));

const agent = (paneId: string, kind: string, cwd: string): AgentInfo => ({
  agent: kind, agentStatus: 'idle', cwd, foregroundCwd: null, focused: false, paneId, tabId: 't1', terminalId: null,
  workspaceId: 'w6', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false,
});
const p1: PaneSummary = { paneId: 'w6:p1', agent: agent('w6:p1', 'claude', '/home/demo/api'), sessionSig: 'a', status: 'idle', preview: null };
const p2: PaneSummary = {
  paneId: 'w6:p2', agent: agent('w6:p2', 'codex', '/home/demo/api/web'), sessionSig: 'b', status: 'idle',
  preview: { text: 'Fixed the toolbar', timestamp: Date.UTC(2026, 7, 19, 10, 5), fromUser: false },
};
const api: ChatSummary = {
  workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents: [p1.agent, p2.agent], panes: [p1, p2],
  preview: p2.preview, sessionSig: 'ab', restoreError: null,
};

it('names its agent and folder, and the workspace it belongs to for VoiceOver', async () => {
  const press = jest.fn();
  const screen = await render(<PaneRow summary={api} pane={p2} unread onPress={press} />);
  expect(screen.getByText('Codex · api/web')).toBeOnTheScreen();
  expect(screen.getByText('Fixed the toolbar')).toBeOnTheScreen();
  const row = screen.getByTestId('pane-row-w6:p2');
  expect(row.props.accessibilityLabel).toBe('Codex in api, api/web, Idle, Unread, Fixed the toolbar');
  await fireEvent.press(row);
  expect(press).toHaveBeenCalledTimes(1);
});

it('says when its own agent is waiting, whatever the workspace says', async () => {
  const screen = await render(<PaneRow summary={api} pane={{ ...p1, status: 'blocked' }} unread={false} onPress={jest.fn()} />);
  expect(screen.getByText('Waiting for your input')).toBeOnTheScreen();
  expect(screen.getByTestId('pane-row-w6:p1').props.accessibilityLabel).toBe('Claude in api, demo/api, Waiting for you');
});
