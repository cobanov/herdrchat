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
  workspaceId: 'w6', agentSession: null, stateChangeSeq: null, completionSeq: null, inputPending: false, name: null, title: null,
});
const p1: PaneSummary = { paneId: 'w6:p1', agent: agent('w6:p1', 'claude', '/home/demo/api'), sessionSig: 'a', status: 'idle', preview: null, sessionTitle: null, agentName: null };
const p2: PaneSummary = {
  paneId: 'w6:p2', agent: agent('w6:p2', 'codex', '/home/demo/api/web'), sessionSig: 'b', status: 'idle',
  preview: { text: 'Fixed the toolbar', timestamp: Date.UTC(2026, 7, 19, 10, 5), fromUser: false },
  sessionTitle: null, agentName: null,
};
const api: ChatSummary = {
  workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents: [p1.agent, p2.agent], panes: [p1, p2],
  preview: p2.preview, sessionSig: 'ab', restoreError: null, sessionTitle: null, agentName: null,
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

// Titled by its session, as the workspace chat's row is; the card above it
// names the workspace, so its line still says only the agent and the folder.
it('titles the row by its agent\'s session, and says the title first', async () => {
  const titled: PaneSummary = { ...p2, sessionTitle: 'Toolbar polish' };
  const screen = await render(<PaneRow summary={api} pane={titled} unread={false} onPress={jest.fn()} />);
  expect(screen.getByText('Toolbar polish')).toBeOnTheScreen();
  expect(screen.getByText('Codex · api/web')).toBeOnTheScreen();
  expect(screen.getByTestId('pane-row-w6:p2').props.accessibilityLabel)
    .toBe('Toolbar polish, Codex in api, api/web, Idle, Fixed the toolbar');
});

// An agent with neither a session title nor a herdr name has no title line:
// the workspace label would repeat the card right above it, and every
// untitled sibling would read the same.
it('falls back to the herdr name, and with neither leads with its provider', async () => {
  const named = await render(<PaneRow summary={api} pane={{ ...p1, agentName: 'api-pm' }} unread={false} onPress={jest.fn()} />);
  expect(named.getByText('api-pm')).toBeOnTheScreen();
  await named.unmount();
  const bare = await render(<PaneRow summary={api} pane={p1} unread={false} onPress={jest.fn()} />);
  expect(bare.queryByText('api')).toBeNull();
  expect(bare.getByTestId('pane-row-w6:p1').props.accessibilityLabel).toMatch(/^Claude in api, /);
});
