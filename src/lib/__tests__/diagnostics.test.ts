import {
  formatDiagnostics,
  type DiagnosticsFacts,
} from '@/features/settings/diagnostics';

const facts = (overrides: Partial<DiagnosticsFacts> = {}): DiagnosticsFacts => ({
  version: '0.5.0',
  build: '40',
  platform: 'iOS',
  osVersion: '26.0',
  hostCount: 2,
  newArchitecture: true,
  glassAvailable: true,
  lastError: null,
  herdrVersion: '0.8.0',
  ...overrides,
});

describe('formatDiagnostics', () => {
  it('leads with the version and build, which is what a report is quoted by', () => {
    expect(formatDiagnostics(facts()).split('\n')[0]).toBe('HerdrChat 0.5.0 (40)');
  });

  it('omits the error line when there was no error', () => {
    expect(formatDiagnostics(facts())).not.toContain('Last error');
  });

  it('includes the error line when there was one', () => {
    expect(formatDiagnostics(facts({ lastError: 'Connection refused' }))).toContain(
      'Last error: Connection refused'
    );
  });

  it('never leaks a host name, address or username', () => {
    // The whole reason `DiagnosticsFacts` carries a count rather than a list:
    // this block gets pasted into public issues, and it describes someone's own
    // machines on their own tailnet.
    const report = formatDiagnostics(facts({ hostCount: 3 }));
    expect(report).toContain('Hosts configured: 3');
    expect(report).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/);
  });

  it('reports a negative New Architecture rather than omitting it', () => {
    // "No" is the answer that explains a bug. Leaving the line out when false
    // would make its absence mean two different things.
    expect(formatDiagnostics(facts({ newArchitecture: false }))).toContain(
      'New Architecture: no'
    );
  });
});
