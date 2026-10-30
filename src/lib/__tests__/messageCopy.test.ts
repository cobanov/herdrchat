import { COPY_LABEL_CHARS, codeBlockLabel, copyOptions } from '../messageCopy';
import type { ChatMessage } from '../transcript/message';

const message = (text: string): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  segments: [{ kind: 'text', text }],
  timestamp: 0,
  agentLabel: null,
  isSidechain: false,
});

describe('copyOptions', () => {
  it('returns the whole message as written', () => {
    expect(copyOptions(message('Run it and see.')).full).toBe('Run it and see.');
  });

  it('has no code option when the message has no code', () => {
    // The case that matters: offering "Copy code" here would put an empty string
    // on the clipboard and silently wipe whatever was there.
    expect(copyOptions(message('Just prose, no fences.')).blocks).toEqual([]);
  });

  it('extracts a fenced block without its fences', () => {
    const text = 'Try this:\n\n```bash\nnpm test\n```\n\nThen look at the output.';
    expect(copyOptions(message(text)).blocks).toEqual([{ label: 'bash: npm test', content: 'npm test' }]);
  });

  // Reported from a phone: "Copy code only" joined every block, so a command,
  // a config snippet and a second command all went on the clipboard together.
  it('offers each block on its own, in order, never joined', () => {
    const text = [
      'First:',
      '```sh',
      'git status --short',
      '```',
      'then the config:',
      '```',
      '{"theme": "dark"}',
      '```',
      'and finally:',
      '```sh',
      'npm ci',
      '```',
    ].join('\n');
    expect(copyOptions(message(text)).blocks).toEqual([
      { label: 'sh: git status --short', content: 'git status --short' },
      { label: '{"theme": "dark"}', content: '{"theme": "dark"}' },
      { label: 'sh: npm ci', content: 'npm ci' },
    ]);
  });

  it('ignores an empty fenced block', () => {
    // An agent mid-stream can emit an opened fence with nothing in it yet.
    expect(copyOptions(message('```\n\n```')).blocks).toEqual([]);
    expect(copyOptions(message('```sh\n  \n```\n\n```sh\nls\n```')).blocks.map((block) => block.content)).toEqual(['ls']);
  });

  it('keeps indentation inside a block, the first line too', () => {
    const text = '```py\n    x = 1\ndef f():\n    return 1\n```';
    expect(copyOptions(message(text)).blocks[0]?.content).toBe('    x = 1\ndef f():\n    return 1');
  });

  // The newlines at the end go, every one of them (a blank line before the
  // closing fence), and nothing else: the last line keeps its trailing spaces.
  it('drops the newlines at the end and nothing else', () => {
    expect(copyOptions(message('```\nls  \n\n```')).blocks[0]?.content).toBe('ls  ');
  });

  // A CRLF transcript leaves each line its \r; pasted into a terminal that is
  // a keypress. The old trim() dropped the last one, so copying must too.
  it('turns Windows line endings into plain ones', () => {
    const text = 'Run:\r\n```sh\r\nls\r\npwd\r\n```\r\n';
    expect(copyOptions(message(text)).blocks[0]?.content).toBe('ls\npwd');
  });

  // Two rows reading "sh: cd repo" would copy different things with nothing to
  // tell them apart.
  it('numbers blocks that would read the same in the sheet', () => {
    const text = '```sh\ncd repo\nnpm ci\n```\n\n```sh\nls\n```\n\n```sh\ncd repo\nnpm test\n```';
    expect(copyOptions(message(text)).blocks).toEqual([
      { label: 'sh: cd repo (1)', content: 'cd repo\nnpm ci' },
      { label: 'sh: ls', content: 'ls' },
      { label: 'sh: cd repo (2)', content: 'cd repo\nnpm test' },
    ]);
  });

  it('ignores tool chips and thinking, which are not the message', () => {
    const withMachinery: ChatMessage = {
      ...message('Done.'),
      segments: [
        { kind: 'thinking', text: 'considering' },
        { kind: 'toolUse', name: 'Bash', input: 'rm -rf /' },
        { kind: 'text', text: 'Done.' },
      ],
    };
    const options = copyOptions(withMachinery);
    expect(options.full).toBe('Done.');
    expect(options.full).not.toContain('rm -rf');
  });
});

describe('codeBlockLabel', () => {
  it('names a block by its language and first line', () => {
    expect(codeBlockLabel('SH', 'git status --short\ngit diff')).toBe('sh: git status --short');
  });

  it('is just the first line when the block names no language', () => {
    expect(codeBlockLabel(null, '{"theme": "dark"}\n')).toBe('{"theme": "dark"}');
  });

  it('skips blank lines to the first one with something on it', () => {
    expect(codeBlockLabel('sh', '\n   \n  cd repo\nnpm ci')).toBe('sh: cd repo');
  });

  // A sheet row is one line; a long command would wrap or be cut by the sheet.
  it('cuts a long line to fit one sheet row', () => {
    const label = codeBlockLabel('sh', 'docker run --rm -it -v "$PWD":/work ghcr.io/example/tool:latest');
    expect(label).toBe('sh: docker run --rm -it -v "$PW…');
    expect(label).toHaveLength(COPY_LABEL_CHARS);
  });

  // The cut counted UTF-16 units, so an emoji at the edge left half a
  // surrogate pair before the ellipsis.
  it('never cuts a character in half', () => {
    const label = codeBlockLabel(null, `${'a'.repeat(30)}😀😀😀`);
    expect(label).toBe(`${'a'.repeat(30)}😀…`);
    expect(Array.from(label)).toHaveLength(COPY_LABEL_CHARS);
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('keeps a suffix whole when it cuts', () => {
    const label = codeBlockLabel('sh', 'docker run --rm -it -v "$PWD":/work ghcr.io/example/tool:latest', ' (2)');
    expect(label).toBe('sh: docker run --rm -it -v… (2)');
    expect(Array.from(label).length).toBeLessThanOrEqual(COPY_LABEL_CHARS);
  });
});
