import {
  explainTarget,
  formatDiagnostics,
  summarizeAgentExplain,
} from '@/features/settings/diagnostics';
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
    expect(formatDiagnostics(facts('blocked via claude.permission'))).toContain(
      'Agent detection: blocked via claude.permission'
    );
  });
});

describe('summarizeAgentExplain', () => {
  // The shape herdr 0.8.0 actually prints, trimmed to the fields that matter
  // here plus the two that must never survive.
  const payload = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      agent: 'claude',
      state: 'blocked',
      matched_rule: { id: 'claude.permission', priority: 10, region: 'tail', state: 'blocked' },
      visible_blocker: true,
      visible_idle: false,
      visible_working: false,
      manifest_source: '/Users/someone/.config/herdr/agents.toml',
      evaluated_rules: [
        {
          id: 'claude.permission',
          matched: true,
          evidence: { region_preview: 'Do you want to proceed? > 1. Yes  2. No', regex: ['\\d\\.'] },
        },
      ],
      ...overrides,
    });

  it('reduces the verdict to one line', () => {
    expect(summarizeAgentExplain(payload())).toBe(
      'blocked via claude.permission, screen blocker'
    );
  });

  it('leaks neither the manifest path nor the screen preview', () => {
    const summary = summarizeAgentExplain(payload()) ?? '';
    // The path carries the host's username; the preview is the agent's screen.
    expect(summary).not.toContain('/Users/someone');
    expect(summary).not.toContain('Do you want to proceed?');
    expect(summary.length).toBeLessThan(80);
  });

  it('names the missing rule rather than inventing one', () => {
    expect(summarizeAgentExplain(payload({ matched_rule: null }))).toBe(
      'blocked via no rule, screen blocker'
    );
  });

  it('omits anything it cannot vet', () => {
    // A blob we cannot parse is a blob we do not paste.
    expect(summarizeAgentExplain(null)).toBeNull();
    expect(summarizeAgentExplain('not json at all')).toBeNull();
    expect(summarizeAgentExplain('"a string"')).toBeNull();
    // No verdict means nothing worth a line.
    expect(summarizeAgentExplain(payload({ state: 42 }))).toBeNull();
  });
});
