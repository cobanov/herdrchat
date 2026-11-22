import { agentName, numberedAgentName } from '../herdr/agentName';

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
    const name = agentName('a'.repeat(31) + ' ' + 'b'.repeat(30));
    expect(name).toBe('a'.repeat(31));
  });

  it('starts with a letter, as herdr requires', () => {
    // herdr refuses a name that starts with a digit (`invalid_agent_name`), and
    // the chat never starts. Folders like that are common.
    expect(agentName('2024-notes')).toBe('chat-2024-notes');
    expect(agentName('42')).toBe('chat-42');
  });

  it('produces only names herdr accepts', () => {
    // It becomes a shell argument, a herdr identifier and probably a filename.
    // herdr's own rule is `[a-z][a-z0-9_-]{0,31}`.
    const labels = ["it's; rm -rf /", '$(whoami)', '../../etc/passwd', 'a\nb', '9'.repeat(60), 'x'.repeat(60), ''];
    for (const label of labels) {
      expect(agentName(label)).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    }
  });
});

describe('numberedAgentName', () => {
  it('adds the number to the name', () => {
    expect(numberedAgentName('myapp', 2)).toBe('myapp-2');
    expect(numberedAgentName('myapp', 9)).toBe('myapp-9');
  });

  it('shortens a long name so the number still fits', () => {
    // Cutting the suffix off instead would ask herdr for the taken name again.
    const long = agentName('a'.repeat(40));
    expect(numberedAgentName(long, 2)).toBe('a'.repeat(30) + '-2');
    expect(numberedAgentName(long, 10)).toBe('a'.repeat(29) + '-10');
  });

  it('does not leave a double dash when the cut lands on one', () => {
    const name = 'a'.repeat(29) + '-bc';
    expect(numberedAgentName(name, 2)).toBe('a'.repeat(29) + '-2');
  });
});
