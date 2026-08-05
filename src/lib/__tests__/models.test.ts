import snapshotFixture from './fixtures/snapshot.json';
import workspaceListFixture from './fixtures/workspace-list.json';

import {
  decodeSnapshot,
  decodeWorkspace,
  hasSessionId,
  needsAttention,
  sessionSignature,
  toAgentStatus,
  type AgentInfo,
} from '../herdr/models';
import { HerdrError, decodeEnvelope } from '../herdr/protocol';

describe('snapshot decoding', () => {
  const snapshot = decodeSnapshot(
    (decodeEnvelope(JSON.stringify(snapshotFixture)) as { snapshot: unknown }).snapshot
  );

  it('decodes every agent and the focus', () => {
    expect(snapshot.agents).toHaveLength(3);
    expect(snapshot.focusedWorkspaceId).toBe('w7');
  });

  it('carries agent state and focus through', () => {
    const working = snapshot.agents.find((agent) => agent.paneId === 'w7:p1');
    expect(working?.agent).toBe('claude');
    expect(working?.agentStatus).toBe('working');
    expect(working?.focused).toBe(true);
  });

  it('marks a blocked agent as needing attention', () => {
    const blocked = snapshot.agents.find((agent) => agent.paneId === 'w8:p1');
    expect(blocked?.agentStatus).toBe('blocked');
    expect(needsAttention(blocked?.agentStatus ?? 'idle')).toBe(true);
  });

  // A status herdr adds later must degrade, not throw. The fixture's "vibing" is
  // exactly that case.
  it('falls back to unknown for a status it has never heard of', () => {
    const future = snapshot.agents.find((agent) => agent.paneId === 'wA:p1');
    expect(future?.agentStatus).toBe('unknown');
    expect(needsAttention('unknown')).toBe(false);
  });

  it('survives the layout geometry round-trip', () => {
    const layout = snapshot.layouts?.[0];
    expect(layout?.workspaceId).toBe('w7');
    expect(layout?.splits[0]?.direction).toBe('right');
    expect(layout?.panes).toHaveLength(2);
  });

  // Layouts are decoded optionally on purpose, so a herdr that stops sending
  // them degrades the geometry rather than the whole snapshot.
  it('tolerates a snapshot with no layouts at all', () => {
    const bare = decodeSnapshot({ agents: [], focused_pane_id: null });
    expect(bare.layouts).toBeNull();
    expect(bare.agents).toEqual([]);
  });

  /**
   * The chat list uses `snapshot.workspaces` when it is there and falls back to
   * a second `workspace list` command when it is not — so the two "no
   * workspaces" cases must stay distinguishable. Null is "this herdr didn't
   * send the field, go and ask"; empty is "there genuinely are none". Collapsing
   * them would either strand an older herdr with a blank list or make every
   * poll pay a round-trip it doesn't need.
   */
  it('separates a missing workspaces field from an empty one', () => {
    expect(decodeSnapshot({ agents: [] }).workspaces).toBeNull();
    expect(decodeSnapshot({ agents: [], workspaces: [] }).workspaces).toEqual([]);
  });

  it('decodes workspaces carried in the snapshot', () => {
    const carried = decodeSnapshot({
      agents: [],
      workspaces: [
        { workspace_id: 'w1', label: 'herdrchat', number: 1, agent_status: 'working' },
      ],
    });
    expect(carried.workspaces).toEqual([
      expect.objectContaining({ workspaceId: 'w1', label: 'herdrchat', agentStatus: 'working' }),
    ]);
  });

  // Read but not yet acted on — the compatibility guard needs somewhere to look.
  it('keeps the version and protocol herdr reports', () => {
    const stamped = decodeSnapshot({ agents: [], version: '0.7.3', protocol: 16 });
    expect(stamped.version).toBe('0.7.3');
    expect(stamped.protocol).toBe(16);
    const unstamped = decodeSnapshot({ agents: [] });
    expect(unstamped.version).toBeNull();
    expect(unstamped.protocol).toBeNull();
  });
});

describe('workspace list decoding', () => {
  it('decodes rows and finds the ones needing attention', () => {
    const result = decodeEnvelope(JSON.stringify(workspaceListFixture)) as {
      workspaces: unknown[];
    };
    const workspaces = result.workspaces.map(decodeWorkspace);

    expect(workspaces).toHaveLength(2);
    expect(workspaces.filter((w) => needsAttention(w.agentStatus)).map((w) => w.label)).toEqual([
      'other',
    ]);
  });
});

describe('envelope', () => {
  it('throws a HerdrError for an error envelope', () => {
    const raw = '{"id":"x","error":{"code":"agent_target_ambiguous","message":"nope"}}';
    expect(() => decodeEnvelope(raw)).toThrow(HerdrError);
    try {
      decodeEnvelope(raw);
    } catch (error) {
      expect((error as HerdrError).code).toBe('agent_target_ambiguous');
    }
  });

  // A host that prints a shell warning before the JSON must fail loudly here
  // rather than hand `undefined` to a decoder three layers up.
  it('rejects output that is not an envelope', () => {
    expect(() => decodeEnvelope('zsh: command not found: herdr')).toThrow(HerdrError);
    expect(() => decodeEnvelope('')).toThrow(HerdrError);
    expect(() => decodeEnvelope('{"id":"x"}')).toThrow(HerdrError);
  });
});

describe('agent status', () => {
  it('accepts the known values and rejects everything else', () => {
    expect(toAgentStatus('working')).toBe('working');
    expect(toAgentStatus('vibing')).toBe('unknown');
    expect(toAgentStatus(undefined)).toBe('unknown');
    expect(toAgentStatus(7)).toBe('unknown');
  });
});

describe('session signature', () => {
  const agent = (overrides: Partial<AgentInfo>): AgentInfo => ({
    agent: 'claude',
    agentStatus: 'idle',
    cwd: '/tmp',
    foregroundCwd: null,
    focused: false,
    paneId: 'p1',
    tabId: 't1',
    terminalId: null,
    workspaceId: 'w1',
    agentSession: { agent: 'claude', kind: 'id', source: 'hook', value: 'sess-a' },
    ...overrides,
  });

  it('is stable regardless of agent order', () => {
    const a = agent({ paneId: 'p1' });
    const b = agent({
      paneId: 'p2',
      agentSession: { agent: 'claude', kind: 'id', source: 'hook', value: 'sess-b' },
    });
    expect(sessionSignature([a, b])).toBe(sessionSignature([b, a]));
    expect(sessionSignature([a, b])).toBe('sess-a,sess-b');
  });

  it('deduplicates agents reporting the same session', () => {
    expect(sessionSignature([agent({ paneId: 'p1' }), agent({ paneId: 'p2' })])).toBe('sess-a');
  });

  // Null, not "": a thread must be able to tell "no session yet" from "some
  // session", because the first means wait and the second means bind.
  it('is null until some agent reports a session id', () => {
    expect(sessionSignature([])).toBeNull();
    expect(sessionSignature([agent({ agentSession: null })])).toBeNull();
    expect(
      sessionSignature([
        agent({ agentSession: { agent: 'claude', kind: 'path', source: 'x', value: '/f.jsonl' } }),
      ])
    ).toBeNull();
  });

  // A pane with no agent has no conversation, so it must not contribute identity.
  it('ignores panes with no agent', () => {
    expect(sessionSignature([agent({ agent: null })])).toBeNull();
  });

  it('reports whether a transcript can be targeted exactly', () => {
    expect(hasSessionId(agent({}))).toBe(true);
    expect(hasSessionId(agent({ agentSession: null }))).toBe(false);
    expect(
      hasSessionId(agent({ agentSession: { agent: 'c', kind: 'id', source: 'x', value: null } }))
    ).toBe(false);
  });
});
