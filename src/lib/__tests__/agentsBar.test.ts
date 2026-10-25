import { agentKindLabel, agentsSummary, liveElapsed, matchingDelegation } from '../subagents/agentsBar';
import type { PlacedItem, ToolCall } from '../threadItems';
import type { AgentsPane } from '../transcript/agentsPane';

const row = (kind: string, task: string, elapsedMs: number, tokens: number) => ({ state: 'running' as const, kind, task, elapsedMs, tokens });

/** Five agents as a real pane listed them (`parseAgentsPane`), and three more below its fold. */
const PANE: AgentsPane = {
  rows: [
    row('fork', 'Verifying the output', (26 * 60 + 52) * 1_000, 156_700),
    row('general-purpose', 'Removing the old build directory', ((60 + 13) * 60 + 1) * 1_000, 286_900),
    row('general-purpose', 'Waiting on results.txt', (51 * 60 + 42) * 1_000, 135_100),
    row('general-purpose', 'Reading the fixtures', (11 * 60 + 31) * 1_000, 251_100),
    row('general-purpose', 'Fixing an import', 45_000, 980),
  ],
  hidden: 3,
};

describe('the agents bar', () => {
  const pane = PANE;
  const readAt = 1_000_000;

  it('says how many work and the longest any has run', () => {
    expect(agentsSummary(pane, readAt, readAt)).toBe('5 agents working · 1h 13m');
    const one = { rows: [pane.rows[4]!], hidden: 0 };
    expect(agentsSummary(one, readAt, readAt)).toBe('1 agent working · 45s');
  });

  it('counts the working rows only, and says done when none works', () => {
    const mixed = { rows: [{ ...pane.rows[1]!, state: 'done' as const }, pane.rows[4]!], hidden: 2 };
    expect(agentsSummary(mixed, readAt, readAt)).toBe('1 agent working · 45s');
    const done = { rows: pane.rows.map((row) => ({ ...row, state: 'done' as const })), hidden: 3 };
    expect(agentsSummary(done, readAt, readAt)).toBe('5 agents done');
  });

  it('ticks a running row on from the read, and not a finished one', () => {
    const row = pane.rows[4]!;
    expect(liveElapsed(row, readAt, readAt + 3_000)).toBe(48_000);
    expect(liveElapsed(row, readAt, readAt - 5_000)).toBe(45_000);
    expect(liveElapsed({ ...row, state: 'done' }, readAt, readAt + 3_000)).toBe(45_000);
    expect(agentsSummary({ rows: [row], hidden: 0 }, readAt, readAt + 20_000)).toBe('1 agent working · 1m 5s');
  });

  it('names the kinds', () => {
    expect(agentKindLabel('fork')).toBe('Fork');
    expect(agentKindLabel('general-purpose')).toBe('General');
    expect(agentKindLabel('Explore')).toBe('Explore');
  });

  it('finds the subagent card a row is about, by its description, the most recent', () => {
    const card = (id: string, description: string): PlacedItem => {
      const call: ToolCall = {
        key: id, kind: 'agent', name: 'Agent', id, result: null, failed: false,
        // The transcript's input preview, as the parser writes it.
        input: `{description: ${description}, subagent_type: general-purpose}`,
      };
      const delegation = {
        state: 'running' as const, background: false, agentId: null, result: null,
        startedAt: null, endedAt: null, durationMs: null, tokens: null, toolUses: null,
      };
      return { item: { kind: 'subagent', key: id, call, delegation }, startsTurn: false, endsGroup: false };
    };
    const items = [card('a', 'Review the notes'), card('b', 'Something else'), card('c', '  Review the notes ')];
    expect(matchingDelegation(items, 'Review the notes')?.call.id).toBe('c');
    expect(matchingDelegation(items, 'Something else ')?.call.id).toBe('b');
    expect(matchingDelegation(items, 'Review the')).toBeNull();
    expect(matchingDelegation(items, '')).toBeNull();
  });
});

