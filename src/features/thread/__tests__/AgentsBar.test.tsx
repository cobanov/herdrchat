import { act, fireEvent, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import { delegateScreen, DELEGATE_DESCRIPTION, DEMO_FORK_TASK } from '@/lib/demo/subagents';
import type { Delegation, PlacedItem, ToolCall } from '@/lib/threadItems';
import { parseAgentsPane, type AgentsPane } from '@/lib/transcript/agentsPane';
import { useAgentsBar } from '@/state/agentsBar';
import { agentsBar } from '@/theme/tokens';
import { AgentsBar } from '../AgentsBar';
import type { DelegationScope } from '../delegation';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/state/connections', () => ({ useConnections: () => null, clientFor: () => null }));
jest.mock('@/components/haptics', () => ({ haptics: { selection: jest.fn(), light: jest.fn() } }));

/** The Demo's pane, 12 s after its call: the reviewer and a fork, and one more. */
const PANE: AgentsPane = parseAgentsPane(delegateScreen(12_000))!;
const READ_AT = 1_000_000;

const scope: DelegationScope = {
  client: null, connectionId: 'demo', workspaceId: 'w2', sessionDirs: ['/home/demo/.claude/projects/notes/session'], transcripts: [],
};
const call: ToolCall = {
  key: 'm1:0', id: 'toolu_review', name: 'Agent', kind: 'agent', result: null, failed: false,
  input: `{description: ${DELEGATE_DESCRIPTION}, subagent_type: general-purpose, model: sonnet}`,
};
const delegation: Delegation = {
  state: 'running', background: false, agentId: null, result: null,
  startedAt: null, endedAt: null, durationMs: null, tokens: null, toolUses: null,
};
const card: PlacedItem = { item: { kind: 'subagent', key: 'm1:0', call, delegation }, startsTurn: true, endsGroup: false };

const bar = (pane: AgentsPane = PANE, items: readonly PlacedItem[] = [card]) =>
  render(<AgentsBar pane={pane} readAt={READ_AT} items={items} scope={scope} connectionId="demo" chat="w2" />);

beforeEach(() => {
  jest.useFakeTimers({ now: READ_AT });
  mockPush.mockClear();
  useAgentsBar.setState({ open: {} });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('folded', () => {
  it('is one line: how many work and the longest time, no rows', async () => {
    const screen = await bar();
    expect(screen.getByTestId('agents-bar-summary')).toHaveTextContent('2 agents working · 2m 15s');
    expect(screen.getByTestId('agents-bar-toggle').props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByTestId('agents-bar-rows')).toBeNull();
  });

  it('says done when every agent is, and none is below the fold', async () => {
    const done = { hidden: 0, rows: PANE.rows.map((row) => ({ ...row, state: 'done' as const })) };
    const screen = await bar(done);
    expect(screen.getByTestId('agents-bar-summary')).toHaveTextContent('2 agents done');
    expect(screen.getByTestId('agents-bar-mark-done')).toBeTruthy();
  });

  it('claims nothing done while agents below the fold may still run', async () => {
    const done = { hidden: 1, rows: PANE.rows.map((row) => ({ ...row, state: 'done' as const })) };
    const screen = await bar(done);
    expect(screen.getByTestId('agents-bar-summary')).toHaveTextContent('2 agents · 1 more in the terminal');
    expect(screen.getByTestId('agents-bar-mark-unknown')).toBeTruthy();
  });

  it('ticks on between reads', async () => {
    const screen = await bar();
    await act(async () => { await jest.advanceTimersByTimeAsync(agentsBar.tick * 5); });
    expect(screen.getByTestId('agents-bar-summary')).toHaveTextContent('2 agents working · 2m 20s');
  });
});

describe('open', () => {
  it('lists each agent with its kind, task, time and tokens, and the ones below the fold', async () => {
    const screen = await bar();
    await fireEvent.press(screen.getByTestId('agents-bar-toggle'));
    expect(screen.getByTestId('agents-bar-toggle').props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByTestId('agents-row-0').props.accessibilityLabel).toBe(
      `General: ${DELEGATE_DESCRIPTION}, running, 12s, 12.4k tokens`
    );
    expect(screen.getByTestId('agents-row-1').props.accessibilityLabel).toBe(
      `Fork: ${DEMO_FORK_TASK}, running, 2m 15s, 48.1k tokens`
    );
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Fork')).toBeTruthy();
    expect(screen.getByTestId('agents-bar-more')).toHaveTextContent('1 more in the terminal');
  });

  it("ticks each row's time", async () => {
    const screen = await bar();
    await fireEvent.press(screen.getByTestId('agents-bar-toggle'));
    await act(async () => { await jest.advanceTimersByTimeAsync(agentsBar.tick * 3); });
    expect(screen.getByTestId('agents-row-0').props.accessibilityLabel).toContain(', 15s,');
  });

  it("opens a row's subagent transcript, as its card does, and leaves a row without a card plain", async () => {
    const screen = await bar();
    await fireEvent.press(screen.getByTestId('agents-bar-toggle'));
    expect(screen.getByTestId('agents-row-0').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('agents-row-1').props.accessibilityRole).toBeUndefined();
    await fireEvent.press(screen.getByTestId('agents-row-0'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chat/agent',
      params: expect.objectContaining({ title: DELEGATE_DESCRIPTION, toolUseId: 'toolu_review', callId: 'toolu_review', followKey: 'toolu_review' }),
    });
  });

  it('opens nothing without a card to match', async () => {
    const screen = await bar(PANE, []);
    await fireEvent.press(screen.getByTestId('agents-bar-toggle'));
    expect(screen.getByTestId('agents-row-0').props.accessibilityRole).toBeUndefined();
  });

  it('stays open for the chat, and folds again on a second tap', async () => {
    const first = await bar();
    await fireEvent.press(first.getByTestId('agents-bar-toggle'));
    await first.unmount();
    const again = await bar();
    expect(again.getByTestId('agents-bar-rows')).toBeTruthy();
    await fireEvent.press(again.getByTestId('agents-bar-toggle'));
    expect(again.queryByTestId('agents-bar-rows')).toBeNull();
  });

  it('marks a done row and a failed one', async () => {
    const mixed = { rows: [{ ...PANE.rows[0]!, state: 'done' as const }, { ...PANE.rows[1]!, state: 'failed' as const }], hidden: 0 };
    const screen = await bar(mixed);
    expect(screen.getByTestId('agents-bar-summary')).toHaveTextContent('1 agent done · 1 failed');
    expect(screen.getByTestId('agents-bar-mark-failed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('agents-bar-toggle'));
    expect(screen.getByTestId('agents-row-0').props.accessibilityLabel).toContain(', done, 12s,');
    expect(screen.getByTestId('agents-row-1').props.accessibilityLabel).toContain(', failed, 2m 15s,');
    expect(screen.queryByTestId('agents-bar-more')).toBeNull();
  });
});
