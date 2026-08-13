import { agentName } from '../herdr/agentName';

describe('agentName', () => {
  it('slugs an ordinary workspace label', () => {
    expect(agentName('HerdrChat')).toBe('herdrchat');
    expect(agentName('my project')).toBe('my-project');
  });

  it('collapses runs of punctuation into one dash', () => {
    expect(agentName('src/lib — herdr (v2)')).toBe('src-lib-herdr-v2');
  });

  it('never starts or ends with a dash', () => {
    // A name ending in punctuation reads as truncated even when it is not.
    expect(agentName('  ...thing...  ')).toBe('thing');
  });

  it('folds accents rather than dropping the letter', () => {
    // "café" must not become "caf" — the workspace is still findable by name.
    expect(agentName('café')).toBe('cafe');
    expect(agentName('Gündüz')).toBe('gunduz');
  });

  it('falls back when nothing survives', () => {
    // Workspaces are named after directories and an emoji-only one is possible.
    expect(agentName('🦊🦊')).toBe('chat');
    expect(agentName('')).toBe('chat');
  });

  it('truncates without leaving a trailing dash', () => {
    const name = agentName('a'.repeat(30) + ' ' + 'b'.repeat(30));
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.endsWith('-')).toBe(false);
  });

  it('produces only shell-safe characters', () => {
    // It becomes a shell argument, a herdr identifier and probably a filename.
    for (const label of ["it's; rm -rf /", '$(whoami)', '../../etc/passwd', 'a\nb']) {
      expect(agentName(label)).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
