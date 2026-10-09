import { act, fireEvent, render, within } from '@testing-library/react-native';

import { DemoHost } from '@/lib/demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '@/lib/demo/fixtures';
import { DEMO_LINKS, DEMO_REVIEW } from '@/lib/demo/subagents';
import { HerdrClient } from '@/lib/herdr/client';
import { sessionDir } from '@/lib/subagents/paths';
import { threadItems, type Delegation, type ThreadItem, type ToolCall } from '@/lib/threadItems';
import { TranscriptStore } from '@/lib/transcript/store';
import { useToolRuns } from '@/state/toolRuns';
import { DelegationScopeProvider, decodeDirs, useDelegationStates, type DelegationScope } from '../delegation';
import { SubagentCard } from '../SubagentCard';
import { resetWorkflowRuns } from '../useWorkflowRun';
import { WorkflowCard } from '../WorkflowCard';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/state/connections', () => ({ useConnections: () => null, clientFor: () => null }));

type Card = Extract<ThreadItem, { kind: 'subagent' | 'workflow' }>;

/** The Demo notes chat's two cards, as the thread places them. */
async function demoCards() {
  const host = new DemoHost();
  const client = new HerdrClient(host);
  const store = new TranscriptStore(host);
  const workspace = DEMO_WORKSPACES[1]!;
  const path = store.sessionTranscriptPath(await store.homeDirectory(), workspace.cwd, DEMO_SESSION_IDS[workspace.paneId]!)!;
  const { messages } = await store.recent(path, null, 400);
  const cards = threadItems(messages, { showSidechain: false })
    .map((placed) => placed.item)
    .filter((item): item is Card => item.kind === 'subagent' || item.kind === 'workflow');
  const scope: DelegationScope = { client, connectionId: 'demo', workspaceId: 'w2', sessionDirs: [sessionDir(path)!] };
  return { links: cards[0] as Extract<Card, { kind: 'subagent' }>, review: cards[1] as Extract<Card, { kind: 'workflow' }>, scope };
}

/** A call's input as the parser flattens it: `{description: …, model: …}`. */
const call = (input: Record<string, string>): ToolCall => ({
  key: 'm1:0', id: 'toolu_x', name: 'Agent', kind: 'agent', result: null, failed: false,
  input: `{${Object.entries(input).map(([key, value]) => `${key}: ${value}`).join(', ')}}`,
});
const delegation = (overrides: Partial<Delegation> = {}): Delegation => ({
  state: 'running', background: false, agentId: null, result: null,
  startedAt: null, endedAt: null, durationMs: null, tokens: null, toolUses: null, ...overrides,
});

beforeEach(() => {
  mockPush.mockClear();
  useToolRuns.setState({ open: {} });
  useDelegationStates.setState({ states: {} });
  resetWorkflowRuns();
});

describe('a subagent card', () => {
  it('says what the agent was asked, which agent on which model, and that it is running', async () => {
    const screen = await render(
      <SubagentCard call={call({ description: 'Fix the play key', subagent_type: 'general-purpose', model: 'claude-sonnet-5' })} delegation={delegation()} />
    );
    const card = within(screen.getByTestId('subagent-toolu_x'));
    expect(card.getByText('Fix the play key')).toBeOnTheScreen();
    expect(card.getByText('general-purpose · Sonnet 5')).toBeOnTheScreen();
    expect(card.getByLabelText('running')).toBeOnTheScreen();
    // Nothing to fold open yet.
    expect(card.getByLabelText(/^Agent: Fix the play key, running/)).toBeDisabled();
  });

  it('folds its result under one line, and opens it with a tap', async () => {
    const screen = await render(
      <SubagentCard
        call={call({ description: 'Check links' })}
        delegation={delegation({ state: 'done', result: 'Two links resolve; one returns 404.', durationMs: 66_000, tokens: 21_450, toolUses: 6 })}
      />
    );
    expect(screen.getByLabelText('done')).toBeOnTheScreen();
    expect(screen.getByText('1m 6s · 21.5k tokens · 6 tool calls')).toBeOnTheScreen();
    expect(screen.queryByText('Two links resolve; one returns 404.')).toBeNull();
    await fireEvent.press(screen.getByLabelText(/^Agent: Check links, done/));
    expect(screen.getByTestId('subagent-toolu_x-result')).toHaveTextContent('Two links resolve; one returns 404.');
    await fireEvent.press(screen.getByLabelText(/^Agent: Check links, done/));
    expect(screen.queryByTestId('subagent-toolu_x-result')).toBeNull();
  });

  it('marks a failed agent with the attention glyph', async () => {
    const screen = await render(
      <SubagentCard call={call({ description: 'Deploy' })} delegation={delegation({ state: 'failed', result: 'Permission denied' })} />
    );
    expect(screen.getByLabelText('failed')).toBeOnTheScreen();
    expect(screen.queryByLabelText('done')).toBeNull();
  });

  it('opens nothing without a session folder to find the agent in', async () => {
    const screen = await render(<SubagentCard call={call({ description: 'Deploy' })} delegation={delegation()} />);
    const chevron = screen.getByTestId('subagent-open-toolu_x');
    expect(chevron).toBeDisabled();
    await fireEvent.press(chevron);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens its own transcript, found by the call that started it', async () => {
    const { links, scope } = await demoCards();
    expect(links.delegation.state).toBe('done');
    const screen = await render(
      <DelegationScopeProvider value={scope}>
        <SubagentCard call={links.call} delegation={links.delegation} />
      </DelegationScopeProvider>
    );
    expect(screen.getByTestId(`subagent-${DEMO_LINKS.toolUseId}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`subagent-open-${DEMO_LINKS.toolUseId}`));
    expect(mockPush).toHaveBeenCalledTimes(1);
    const { pathname, params } = mockPush.mock.calls[0]![0] as { pathname: string; params: Record<string, string> };
    expect(pathname).toBe('/chat/agent');
    expect(params).toMatchObject({
      connectionId: 'demo',
      workspaceId: 'w2',
      title: DEMO_LINKS.description,
      toolUseId: DEMO_LINKS.toolUseId,
      followKey: DEMO_LINKS.toolUseId,
      state: 'done',
    });
    expect(params.agentId).toBeUndefined();
    expect(decodeDirs(params.dirs)).toEqual(scope.sessionDirs);
    // An open agent screen learns where its card stands from here.
    expect(useDelegationStates.getState().states[DEMO_LINKS.toolUseId]).toBe('done');
  });

  it('opens a background agent by the id its launch reported', async () => {
    const { scope } = await demoCards();
    const screen = await render(
      <DelegationScopeProvider value={scope}>
        <SubagentCard call={call({ description: 'Watch the build' })} delegation={delegation({ background: true, agentId: 'abc123' })} />
      </DelegationScopeProvider>
    );
    await fireEvent.press(screen.getByTestId('subagent-open-toolu_x'));
    const { params } = mockPush.mock.calls[0]![0] as { params: Record<string, string> };
    expect(params).toMatchObject({ agentId: 'abc123', state: 'running' });
    expect(params.toolUseId).toBeUndefined();
  });
});

describe('a workflow card', () => {
  it('names the workflow from its script before its run file is read', async () => {
    const { review } = await demoCards();
    const screen = await render(<WorkflowCard call={review.call} delegation={review.delegation} runId={review.runId} name={review.name} description={review.description} />);
    const card = within(screen.getByTestId(`workflow-${DEMO_REVIEW.toolUseId}`));
    expect(card.getByText(DEMO_REVIEW.name)).toBeOnTheScreen();
    expect(card.getByText(DEMO_REVIEW.summary)).toBeOnTheScreen();
    expect(card.getByLabelText('running')).toBeOnTheScreen();
    expect(screen.getByTestId(`workflow-open-${DEMO_REVIEW.toolUseId}`)).toBeDisabled();
  });

  it('reads its run: progress on the card, and its phases and agents when opened', async () => {
    const { review, scope } = await demoCards();
    const screen = await render(
      <DelegationScopeProvider value={scope}>
        <WorkflowCard call={review.call} delegation={review.delegation} runId={review.runId} name={review.name} description={review.description} />
      </DelegationScopeProvider>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText('2 of 3 agents done · 47.8k tokens')).toBeOnTheScreen();
    expect(screen.queryByText('Check')).toBeNull();

    await fireEvent.press(screen.getByLabelText(/^Workflow: release-review, running/));
    expect(screen.getByText('Check')).toBeOnTheScreen();
    expect(screen.getByText('Review')).toBeOnTheScreen();
    expect(screen.getByTestId('workflow-agent-check:links')).toHaveProp('accessibilityLabel', 'check:links, done, Opus 5 · 48s');
    expect(screen.getByTestId('workflow-agent-review:wording').props.accessibilityLabel).toMatch(/^review:wording, running/);

    await fireEvent.press(screen.getByTestId(`workflow-open-${DEMO_REVIEW.toolUseId}`));
    const { pathname, params } = mockPush.mock.calls[0]![0] as { pathname: string; params: Record<string, string> };
    expect(pathname).toBe('/chat/workflow');
    expect(params).toMatchObject({ runId: DEMO_REVIEW.runId, title: DEMO_REVIEW.name, workspaceId: 'w2' });
    // The run's agents report where they stand, for an open agent screen.
    expect(Object.values(useDelegationStates.getState().states)).toEqual(expect.arrayContaining(['done', 'running']));
  });
});
