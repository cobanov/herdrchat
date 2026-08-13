import { explainTarget, formatDiagnostics } from '@/features/settings/diagnostics';
import type { AgentInfo, AgentStatus } from '@/lib/herdr/models';

const agent = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  agent: 'claude',
  agentStatus: 'idle' as AgentStatus,
  cwd: '/w',
  foregroundCwd: null,
  focused: false,
  paneId: 'p1',
  tabId: 't1',
  terminalId: null,
  workspaceId: 'w1',
  agentSession: null,
  ...overrides,
});

const facts = (agentExplain: string | null | undefined) => ({
  version: '0.7.1',
  build: '45',
  platform: 'iOS',
  osVersion: '26.0',
  hostCount: 1,
  newArchitecture: true,
  glassAvailable: true,
  lastError: null,
  herdrVersion: '0.8.0',
  agentExplain,
});

describe('explainTarget', () => {
  it('has nothing to explain when no pane runs an agent', () => {
    expect(explainTarget([agent({ agent: null })])).toBeNull();
    expect(explainTarget([])).toBeNull();
  });

  it('prefers a blocked agent, because that is what people report', () => {
    const agents = [
      agent({ paneId: 'idle', focused: true }),
      agent({ paneId: 'stuck', agentStatus: 'blocked' }),
    ];
    expect(explainTarget(agents)).toBe('stuck');
  });

  it('falls back to the focused agent, then to the first one', () => {
    expect(
      explainTarget([agent({ paneId: 'a' }), agent({ paneId: 'b', focused: true })])
    ).toBe('b');
    expect(explainTarget([agent({ paneId: 'a' }), agent({ paneId: 'b' })])).toBe('a');
  });
});

describe('formatDiagnostics with an explanation', () => {
  it('omits the line when the host did not answer', () => {
    // Off the tailnet the rest of the block is still worth pasting.
    expect(formatDiagnostics(facts(null))).not.toContain('Agent detection');
    expect(formatDiagnostics(facts(undefined))).not.toContain('Agent detection');
    expect(formatDiagnostics(facts(''))).not.toContain('Agent detection');
  });

  it('carries the explanation when there is one', () => {
    expect(formatDiagnostics(facts('{"status":"blocked"}'))).toContain(
      'Agent detection: {"status":"blocked"}'
    );
  });
});
