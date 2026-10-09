import { fireEvent, render } from '@testing-library/react-native';

import { ChatRow } from '../ChatRow';
import type { ChatSummary } from '../useWorkspaces';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));

const summary = (agent: string | null): ChatSummary => ({
  workspaceId: 'w1',
  title: 'Parser',
  number: 1,
  status: 'idle',
  agents: [{
    agent,
    agentStatus: 'idle',
    cwd: '/home/me/code/parser',
    foregroundCwd: null,
    focused: true,
    paneId: 'p1',
    tabId: 't1',
    terminalId: null,
    workspaceId: 'w1',
    agentSession: null,
    stateChangeSeq: null,
    completionSeq: null,
    inputPending: false,
    name: null,
    title: null,
  }],
  panes: [],
  preview: null,
  sessionSig: null,
  restoreError: null,
  sessionTitle: null,
  agentName: null,
});

// A swipe is invisible to VoiceOver and Voice Control; the same actions have
// to be offered as accessibility actions or they don't exist for them (#112).
it('offers its swipe actions to assistive technology', async () => {
  const rename = jest.fn();
  const close = jest.fn();
  const screen = await render(
    <ChatRow
      summary={summary('claude')}
      unread={false}
      onPress={jest.fn()}
      actions={[
        { name: 'rename', label: 'Rename', run: rename },
        { name: 'close', label: 'Close chat', run: close },
      ]}
    />
  );
  const row = screen.getByTestId('chat-row-w1');
  expect(row).toHaveProp('accessibilityActions', [
    { name: 'rename', label: 'Rename' },
    { name: 'close', label: 'Close chat' },
  ]);
  await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'close' } });
  expect(close).toHaveBeenCalledTimes(1);
  expect(rename).not.toHaveBeenCalled();
});

it.each([
  ['claude', 'Claude · code/parser'],
  ['omp', 'OMP · code/parser'],
  ['letta', 'Letta · code/parser'],
  ['aider', 'aider · code/parser'],
  [null, 'Terminal'],
])('names a %s pane as %s', async (agent, context) => {
  const screen = await render(<ChatRow summary={summary(agent)} unread={false} onPress={jest.fn()} />);
  expect(screen.getByText(context)).toBeOnTheScreen();
});

// A failed restore used to look like an empty chat (#119).
it('says why herdr could not restore a chat', async () => {
  const screen = await render(
    <ChatRow
      summary={{ ...summary('claude'), restoreError: 'Saved directory is unavailable.' }}
      unread={false}
      onPress={jest.fn()}
    />
  );
  expect(screen.getByTestId('chat-row-restore-error')).toHaveTextContent(
    "Couldn't restore. Saved directory is unavailable."
  );
  expect(screen.getByTestId('chat-row-w1').props.accessibilityLabel).toContain('Saved directory is unavailable.');
});

// A two-agent workspace used to be named after whichever agent the election
// picked, so it looked exactly like a one-agent workspace.
it('names every agent of a workspace that runs several, and the folder they share', async () => {
  const base = summary('claude');
  const [first] = base.agents;
  if (first === undefined) throw new Error('fixture has an agent');
  const second = { ...first, agent: 'codex', paneId: 'p2', focused: false, cwd: '/home/me/code/parser/web' };
  const pane = (agent: typeof first) => ({ paneId: agent.paneId, agent, sessionSig: null, preview: null, status: 'idle' as const, sessionTitle: null, agentName: null });
  const group: ChatSummary = { ...base, agents: [first, second], panes: [pane(first), pane(second)] };
  const screen = await render(<ChatRow summary={group} unread={false} onPress={jest.fn()} />);
  expect(screen.getByText('2 agents · Claude, Codex · code/parser')).toBeOnTheScreen();
});

// The session's title is what a person calls the conversation; the workspace
// label, a folder or slot name, moves to the line under it.
it('titles a chat by its session, with the workspace ahead of the agent below', async () => {
  const screen = await render(
    <ChatRow summary={{ ...summary('claude'), title: 'Scratch', sessionTitle: 'Herdrchat repository clone' }} unread={false} onPress={jest.fn()} />
  );
  expect(screen.getByText('Herdrchat repository clone')).toBeOnTheScreen();
  expect(screen.getByText('Scratch · Claude · code/parser')).toBeOnTheScreen();
  expect(screen.getByTestId('chat-row-w1').props.accessibilityLabel)
    .toMatch(/^Herdrchat repository clone, Scratch · Claude · code\/parser, Idle/);
  // A workspace named after its folder is said once, in the folder.
  await screen.rerender(
    <ChatRow summary={{ ...summary('claude'), sessionTitle: 'Herdrchat repository clone' }} unread={false} onPress={jest.fn()} />
  );
  expect(screen.getByText('Claude · code/parser')).toBeOnTheScreen();
});

it('keeps the workspace label as the title while the session has none', async () => {
  const screen = await render(<ChatRow summary={summary('claude')} unread={false} onPress={jest.fn()} />);
  expect(screen.getByText('Parser')).toBeOnTheScreen();
  expect(screen.getByTestId('chat-row-w1').props.accessibilityLabel).toMatch(/^Parser, Claude · code\/parser/);
});

// A chat on one of the host's machines: its machine leads the line under the
// title, and its testID has no slash (`chat-row-<machineId>-<workspaceId>`).
it('says which machine a chat is on, first, and is found by a slash-free testID', async () => {
  const onNuku = { ...summary('claude'), machine: { id: 'demo-nuku', label: 'nuku' } };
  const screen = await render(<ChatRow summary={onNuku} unread={false} onPress={jest.fn()} />);
  expect(screen.getByText('nuku · Claude · code/parser')).toBeOnTheScreen();
  expect(screen.getByTestId('chat-row-demo-nuku-w1').props.accessibilityLabel).toMatch(/^Parser, nuku · Claude · code\/parser/);
  expect(screen.queryByTestId('chat-row-w1')).toBeNull();
});
