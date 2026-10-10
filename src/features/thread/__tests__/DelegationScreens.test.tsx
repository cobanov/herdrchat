import { act, fireEvent, render, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { View as MockView, type ViewProps } from 'react-native';

import { DemoHost } from '@/lib/demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '@/lib/demo/fixtures';
import { DEMO_LINKS, DEMO_REVIEW } from '@/lib/demo/subagents';
import { HerdrClient } from '@/lib/herdr/client';
import { sessionDir } from '@/lib/subagents/paths';
import { TranscriptStore } from '@/lib/transcript/store';
import { useDelegationStates } from '../delegation';
import SubagentScreen from '../SubagentScreen';
import { resetWorkflowRuns } from '../useWorkflowRun';
import WorkflowScreen from '../WorkflowScreen';

const mockPush = jest.fn();
const mockClient = new HerdrClient(new DemoHost());
/** Every row the list was given, drawn, so a test can find any of them. */
const mockList = jest.fn((props: { data: unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactElement }) => (
  <MockView testID={(props as { testID?: string }).testID}>{props.data.map((item, index) => <MockView key={index}>{props.renderItem({ item, index })}</MockView>)}</MockView>
));
jest.mock('@shopify/flash-list', () => ({ FlashList: (props: Parameters<typeof mockList>[0]) => mockList(props) }));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) }, useFocusEffect: jest.fn() }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
// One database for the app's life, as the provider gives.
const mockDb = {};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: ViewProps) => <MockView {...props} />,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({
  Glass: (props: ViewProps) => <MockView {...props} />,
  EdgeFade: () => null,
  useGlassAvailable: () => false,
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/components/Markdown', () => {
  const { Text } = jest.requireActual('react-native');
  return { Markdown: ({ children, text }: { children?: string; text?: string }) => <Text>{text ?? children}</Text> };
});
jest.mock('@/state/connections', () => ({
  useConnections: (select: (state: { connections: { id: string }[] }) => unknown) => select({ connections: [{ id: 'demo' }] }),
  clientFor: () => mockClient,
}));
jest.mock('@/state/threadCache', () => ({
  appendMessages: jest.fn(async () => undefined),
  rebind: jest.fn(async () => false),
  replaceMessages: jest.fn(async () => undefined),
  seedMessages: jest.fn(async () => []),
}));

async function notesDir() {
  const store = new TranscriptStore(mockClient.transport);
  const workspace = DEMO_WORKSPACES[1]!;
  return sessionDir(store.sessionTranscriptPath(await store.homeDirectory(), workspace.cwd, DEMO_SESSION_IDS[workspace.paneId]!)!)!;
}

const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(() => {
  mockPush.mockClear();
  useDelegationStates.setState({ states: {} });
  resetWorkflowRuns();
});

it('shows a subagent\'s own transcript, found by the call that started it, with no composer', async () => {
  const dir = await notesDir();
  const screen = await render(
    <SubagentScreen
      connectionId="demo"
      workspaceId="w2"
      dirs={[dir]}
      parents={[`${dir}.jsonl`]}
      callId={DEMO_LINKS.toolUseId}
      target={{ kind: 'call', toolUseId: DEMO_LINKS.toolUseId }}
      title={DEMO_LINKS.description}
      subtitle="general-purpose · sonnet"
      followKey={DEMO_LINKS.toolUseId}
      initialState="done"
      onBack={jest.fn()}
    />
  );
  for (let step = 0; step < 6; step += 1) await settle();
  const header = within(screen.getByTestId('subagent-header'));
  expect(header.getByTestId('subagent-title')).toHaveTextContent(DEMO_LINKS.description);
  // The meta, once read, names the agent and its model.
  expect(header.getByTestId('subagent-meta')).toHaveTextContent('general-purpose · sonnet');
  expect(header.getByLabelText('done')).toBeOnTheScreen();
  const list = within(screen.getByTestId('subagent-messages'));
  expect(list.getByText(/Two resolve; https:\/\/example.com\/old-guide returns 404/)).toBeOnTheScreen();
  expect(screen.queryByTestId('thread-controls')).toBeNull();
  await screen.unmount();
});

it('says a running agent is starting until its meta is written', async () => {
  const dir = await notesDir();
  const screen = await render(
    <SubagentScreen
      connectionId="demo"
      workspaceId="w2"
      dirs={[dir]}
      parents={[`${dir}.jsonl`]}
      callId="toolu_not_yet"
      target={{ kind: 'call', toolUseId: 'toolu_not_yet' }}
      title="Review the wording"
      subtitle=""
      followKey="toolu_not_yet"
      initialState="running"
      onBack={jest.fn()}
    />
  );
  await settle();
  await settle();
  expect(screen.getByText('Starting')).toBeOnTheScreen();
  await screen.unmount();
});

// Claude writes the run file only when the run ends; before, the screen
// said "Starting" for the whole run and no agent could be opened.
it('shows a running workflow\'s phases and agents from its journal, and opens an agent\'s transcript', async () => {
  const dir = await notesDir();
  const screen = await render(
    <WorkflowScreen
      connectionId="demo"
      workspaceId="w2"
      dirs={[dir]}
      runId={DEMO_REVIEW.runId}
      title={DEMO_REVIEW.name}
      followKey={DEMO_REVIEW.toolUseId}
      initialState="running"
      onBack={jest.fn()}
    />
  );
  await settle();
  await settle();
  expect(screen.getByTestId('workflow-title')).toHaveTextContent(DEMO_REVIEW.name);
  expect(screen.getByTestId('workflow-phase-Check')).toBeOnTheScreen();
  expect(screen.getByTestId('workflow-phase-Review')).toBeOnTheScreen();
  const wording = screen.getByTestId('workflow-agent-review:wording');
  expect(wording.props.accessibilityLabel).toMatch(/^review:wording, running/);
  expect(screen.getByTestId('workflow-header')).toBeOnTheScreen();
  expect(within(screen.getByTestId('workflow-header')).getByLabelText('running')).toBeOnTheScreen();

  await fireEvent.press(screen.getByTestId('workflow-agent-check:links'));
  const { pathname, params } = mockPush.mock.calls[0]![0] as { pathname: string; params: Record<string, string> };
  expect(pathname).toBe('/chat/agent');
  expect(params).toMatchObject({ title: 'check:links', runId: DEMO_REVIEW.runId, state: 'done' });
  expect(params.followKey).toBe(`${DEMO_REVIEW.runId}/${params.agentId}`);
  await screen.unmount();
});

const advance = (ms: number) => act(async () => {
  await jest.advanceTimersByTimeAsync(ms);
});

describe('on the clock', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // An ended run whose files are gone is said to be gone, and not polled.
  it('says an ended run that left no files is not on this host', async () => {
    const dir = await notesDir();
    const exec = jest.spyOn(mockClient.transport, 'exec');
    const screen = await render(
      <WorkflowScreen
        connectionId="demo"
        workspaceId="w2"
        dirs={[dir]}
        runId="wf_cleaned-up"
        title="release-review"
        followKey="toolu_gone"
        initialState="done"
        onBack={jest.fn()}
      />
    );
    await advance(10);
    expect(screen.getByText('Not on this host')).toBeOnTheScreen();
    const reads = exec.mock.calls.length;
    await advance(30_000);
    expect(exec.mock.calls.length).toBe(reads);
    exec.mockRestore();
    await screen.unmount();
  });

  // The chat under an open agent screen stops reading its transcript, so its
  // card never said the agent ended and the screen followed it for as long as
  // it was open. Last: it adds the scenario's agent to the Demo's notes chat.
  it('learns its agent ended with no card in the chat to say so, and stops following', async () => {
    const dir = await notesDir();
    const host = mockClient.transport;
    const streams: (AbortSignal | undefined)[] = [];
    const stream = host.streamLines.bind(host);
    jest.spyOn(host, 'streamLines').mockImplementation((command, timeout, signal) => {
      streams.push(signal);
      return stream(command, timeout, signal);
    });
    const exec = jest.spyOn(host, 'exec');
    await mockClient.sendPrompt('w2:p1', 'please delegate the review');
    await advance(1_600);
    const { messages } = await new TranscriptStore(host).recent(`${dir}.jsonl`, null, 400);
    const call = messages.flatMap((message) => message.segments).filter((segment) => segment.kind === 'toolUse').at(-1);
    if (call?.kind !== 'toolUse' || call.id === undefined) throw new Error('the scenario made no call');

    const screen = await render(
      <SubagentScreen
        connectionId="demo"
        workspaceId="w2"
        dirs={[dir]}
        parents={[`${dir}.jsonl`]}
        callId={call.id}
        target={{ kind: 'call', toolUseId: call.id }}
        title="Review the release notes wording"
        subtitle=""
        followKey={call.id}
        initialState="running"
        onBack={jest.fn()}
      />
    );
    await advance(100);
    const header = () => within(screen.getByTestId('subagent-header'));
    expect(header().getByLabelText('running')).toBeOnTheScreen();
    expect(streams).toHaveLength(1);
    expect(useDelegationStates.getState().states[call.id]).toBeUndefined();

    // The result lands in the main transcript; nothing reports it to the store.
    for (let step = 0; step < 4; step += 1) await advance(2_000);
    expect(header().getByLabelText('done')).toBeOnTheScreen();
    expect(streams[0]?.aborted).toBe(true);
    expect(within(screen.getByTestId('subagent-messages')).getByText(/pinned on first contact/)).toBeOnTheScreen();

    // Ended: no more reads of the parent, no new stream.
    const asked = exec.mock.calls.filter(([command]) => command.includes('grep -F')).length;
    await advance(30_000);
    expect(exec.mock.calls.filter(([command]) => command.includes('grep -F')).length).toBe(asked);
    expect(streams).toHaveLength(1);
    exec.mockRestore();
    await screen.unmount();
  });
});
