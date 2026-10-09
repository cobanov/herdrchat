import { HerdrClient } from '../herdr/client';
import { DemoHost } from '../demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '../demo/fixtures';
import { DEMO_PHRASES } from '../demo/scenarios';
import { DELEGATE_DESCRIPTION, DELEGATE_RESULT, DEMO_LINKS, DEMO_REVIEW } from '../demo/subagents';
import { agentTranscriptPath, sessionDir, workflowRunPath } from '../subagents/paths';
import { SubagentReader } from '../subagents/reader';
import { parseWorkflowRun } from '../subagents/workflowRun';
import { threadItems, type ThreadItem } from '../threadItems';
import { TranscriptStore } from '../transcript/store';

/** The notes chat (w2), where the Demo's subagent and workflow live. */
async function notes(host: DemoHost) {
  const store = new TranscriptStore(host);
  const workspace = DEMO_WORKSPACES[1]!;
  const path = store.sessionTranscriptPath(await store.homeDirectory(), workspace.cwd, DEMO_SESSION_IDS[workspace.paneId]!)!;
  return { store, path, dir: sessionDir(path)!, reader: new SubagentReader(host) };
}

const cards = async (store: TranscriptStore, path: string) => {
  const { messages } = await store.recent(path, 'claude', 400);
  const placed = threadItems(messages, { showSidechain: false });
  return {
    placed,
    cards: placed.map((entry) => entry.item)
      .filter((item): item is Extract<ThreadItem, { kind: 'subagent' | 'workflow' }> => item.kind === 'subagent' || item.kind === 'workflow'),
  };
};

describe('the Demo notes chat hands work to agents', () => {
  it('shows a finished subagent and a running workflow, and still ends on its summary', async () => {
    const { store, path } = await notes(new DemoHost());
    const { placed, cards: found } = await cards(store, path);
    expect(found.map((card) => [card.kind, card.delegation.state])).toEqual([['subagent', 'done'], ['workflow', 'running']]);
    expect(found[0]!.call.id).toBe(DEMO_LINKS.toolUseId);
    expect(found[0]!.delegation.result).toContain('returns 404');
    expect(found[1]).toMatchObject({ name: DEMO_REVIEW.name, runId: DEMO_REVIEW.runId, delegation: { background: true } });
    // The UI flows open w2 on its summary; it stays the last row.
    const last = placed.at(-1)!.item;
    expect(last.kind === 'agent' && last.message.id).toBe('d2-2');
  });

  it('resolves the subagent from its meta and serves its transcript, emoji and all', async () => {
    const { store, dir, reader } = await notes(new DemoHost());
    const resolved = await reader.resolve(dir, DEMO_LINKS.toolUseId);
    expect(resolved).toMatchObject({ agentId: DEMO_LINKS.agentId, meta: { description: DEMO_LINKS.description, model: 'sonnet' } });
    await expect(reader.resolve(dir, 'toolu_nobody')).resolves.toBeNull();

    const { messages } = await store.recent(agentTranscriptPath(dir, resolved!.agentId), 'claude', 400);
    expect(messages.every((message) => message.isSidechain)).toBe(true);
    // A subagent's whole transcript is a sidechain: its screen shows them.
    expect(threadItems(messages, { showSidechain: true }).map((entry) => entry.item.kind)).toEqual(['user', 'tools', 'agent']);
    expect(JSON.stringify(messages.at(-1)!.segments)).toContain('🔗');
  });

  it('serves the workflow run with two phases and one agent still working, and only again when it changed', async () => {
    const { store, dir, reader } = await notes(new DemoHost());
    const first = await reader.readIfChanged(workflowRunPath(dir, DEMO_REVIEW.runId), null);
    if (first.kind !== 'text') throw new Error(`expected the run, got ${first.kind}`);
    const run = parseWorkflowRun(first.text)!;
    expect(run).toMatchObject({ name: DEMO_REVIEW.name, status: 'running' });
    expect(run.phases.map((phase) => [phase.title, phase.agents.map((agent) => [agent.label, agent.state])])).toEqual([
      ['Check', [['check:links', 'done'], ['check:changelog', 'done']]],
      ['Review', [['review:wording', 'running']]],
    ]);
    await expect(reader.readIfChanged(workflowRunPath(dir, DEMO_REVIEW.runId), first.signature))
      .resolves.toEqual({ kind: 'unchanged', signature: first.signature });
    await expect(reader.readIfChanged(workflowRunPath(dir, 'wf_missing'), null)).resolves.toEqual({ kind: 'absent' });

    // Each agent's transcript is where the run's folder says.
    const running = run.phases[1]!.agents[0]!;
    const { messages } = await store.recent(agentTranscriptPath(dir, running.agentId!, DEMO_REVIEW.runId), 'claude', 400);
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe(`"${DEMO_PHRASES.delegate}"`, () => {
  it('starts a subagent that works for a few seconds, its transcript growing, then lands its result', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    const { store, path, dir, reader } = await notes(host);

    await client.sendPrompt('w2:p1', 'please delegate the review');
    expect((await client.workspaces())[1]?.agentStatus).toBe('working');
    const before = await cards(store, path);
    expect(before.cards).toHaveLength(2);

    // The call lands with its meta: the card runs, and resolves.
    now += 1_500;
    const started = (await cards(store, path)).cards.at(-1)!;
    expect(started).toMatchObject({ kind: 'subagent', delegation: { state: 'running' } });
    const resolved = (await reader.resolve(dir, started.call.id!))!;
    expect(resolved.meta.description).toBe(DELEGATE_DESCRIPTION);
    const transcript = agentTranscriptPath(dir, resolved.agentId);
    const length = async () => (await store.recent(transcript, 'claude', 400)).messages.length;
    expect(await length()).toBe(1);

    // Its own transcript grows while the card still runs.
    now += 2_500;
    expect(await length()).toBe(3);
    expect((await cards(store, path)).cards.at(-1)!.delegation.state).toBe('running');

    // Then its result lands, and the agent closes.
    now += 2_500;
    expect(await length()).toBe(4);
    const { cards: done, placed } = await cards(store, path);
    expect(done.at(-1)!.delegation).toMatchObject({ state: 'done', result: DELEGATE_RESULT });
    expect(placed.at(-1)!.item.kind).toBe('agent');
    expect((await client.workspaces())[1]?.agentStatus).toBe('idle');
  });
});
