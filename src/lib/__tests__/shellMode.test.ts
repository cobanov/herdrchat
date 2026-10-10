import { claudeShell } from '../transcript/harness';
import { isToolOnly, receiptKey, type ChatMessage, type MessageSegment } from '../transcript/message';
import { parseTranscript, parseTranscriptLine } from '../transcript/parser';
import { previewText } from '../transcript/store';
import { foldShellOutput, isShellDraft, shellOutputText, shellReceiptText } from '../shellMode';
import { threadItems, type ShellItem } from '../threadItems';

/** A Claude user line, in the shape 2.1.286 writes for shell mode. */
const user = (content: unknown, uuid = 'u1') =>
  JSON.stringify({ type: 'user', uuid, timestamp: '2026-10-04T14:27:13.718Z', message: { role: 'user', content } });
const assistant = (text: string, uuid = 'a1') =>
  JSON.stringify({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'text', text }] } });

describe('reading shell mode', () => {
  // Measured: `! pwd` in a Claude Code 2.1.286 session on this Mac.
  it('reads the command Claude records, without the space it adds', () => {
    expect(claudeShell('<bash-input> pwd</bash-input>')).toEqual({ command: 'pwd', output: null });
    expect(claudeShell('<bash-input>ls -la</bash-input>')).toEqual({ command: 'ls -la', output: null });
  });

  it('keeps quotes and newlines in a command', () => {
    expect(claudeShell(`<bash-input> ssh nuku 'echo "hi"'\necho done</bash-input>`)?.command)
      .toBe(`ssh nuku 'echo "hi"'\necho done`);
  });

  it('reads the output with and without stderr', () => {
    expect(claudeShell('<bash-stdout>/Users/kenneth</bash-stdout><bash-stderr></bash-stderr>'))
      .toEqual({ command: null, output: { stdout: '/Users/kenneth', stderr: '' } });
    expect(claudeShell('<bash-stdout></bash-stdout><bash-stderr>ls: /nope: No such file or directory\n</bash-stderr>'))
      .toEqual({ command: null, output: { stdout: '', stderr: 'ls: /nope: No such file or directory' } });
    expect(claudeShell('<bash-stdout>one</bash-stdout>')).toEqual({ command: null, output: { stdout: 'one', stderr: '' } });
  });

  it('shows Claude\'s "no output" note as no output', () => {
    expect(claudeShell('<bash-stdout>(Bash completed with no output)</bash-stdout><bash-stderr></bash-stderr>')?.output)
      .toEqual({ stdout: '', stderr: '' });
  });

  it('strips colour codes and keeps indentation', () => {
    expect(claudeShell('<bash-stdout>\u001b[32m M\u001b[0m src/a.ts\n  b</bash-stdout><bash-stderr></bash-stderr>')?.output?.stdout)
      .toBe(' M src/a.ts\n  b');
  });

  // A `cat` of a file that mentions the tags: Claude does not escape them.
  it('keeps output that contains the closing tag', () => {
    expect(claudeShell('<bash-stdout>a</bash-stdout> b</bash-stdout><bash-stderr></bash-stderr>')?.output?.stdout)
      .toBe('a</bash-stdout> b');
  });

  it('leaves a turn with anything else in it alone', () => {
    expect(claudeShell('<bash-input>ls</bash-input> and also this')).toBeNull();
    expect(claudeShell('hello')).toBeNull();
    expect(claudeShell('<local-command-stdout>x</local-command-stdout>')).toBeNull();
  });

  it('parses both turns into shell segments, string or text block', () => {
    expect(parseTranscriptLine(user('<bash-input> pwd</bash-input>'))?.segments).toEqual([{ kind: 'shellInput', command: 'pwd' }]);
    expect(parseTranscriptLine(user([{ type: 'text', text: '<bash-stdout>x</bash-stdout><bash-stderr>y</bash-stderr>' }]))?.segments)
      .toEqual([{ kind: 'shellOutput', stdout: 'x', stderr: 'y' }]);
    expect(parseTranscriptLine(user('<bash-input>ls</bash-input><bash-stdout>a</bash-stdout><bash-stderr></bash-stderr>'))?.segments)
      .toEqual([{ kind: 'shellInput', command: 'ls' }, { kind: 'shellOutput', stdout: 'a', stderr: '' }]);
  });

  it('keeps the chat preview on the command, never on its output', () => {
    const messages = parseTranscript([user('<bash-input> pwd</bash-input>', 'u1'), user('<bash-stdout>/x</bash-stdout><bash-stderr></bash-stderr>', 'u2')].join('\n'));
    expect(isToolOnly(messages[0]!)).toBe(false);
    expect(isToolOnly(messages[1]!)).toBe(true);
    expect(previewText(messages[0]!)).toBe('! pwd');
  });
});

describe('the receipt of a sent shell line', () => {
  const echo = (text: string): ChatMessage => ({
    id: 'local-1', role: 'user', segments: [{ kind: 'text', text }], timestamp: 1, agentLabel: null, isSidechain: false,
  });
  const recorded = (typed: string) => parseTranscriptLine(user(`<bash-input> ${typed.replace(/^!\s*/, '')}</bash-input>`))!;

  it.each(['!pwd', '! pwd', '!  pwd '])('confirms %j by the line Claude records', (typed) => {
    expect(receiptKey(recorded(typed))).toBe(receiptKey(echo(typed)));
  });

  it('confirms a command with quotes', () => {
    const typed = `! git commit -m "it's done"`;
    expect(receiptKey(recorded(typed))).toBe(receiptKey(echo(typed)));
  });

  it('never confirms a different command', () => {
    expect(receiptKey(recorded('! ls'))).not.toBe(receiptKey(echo('! ls -la')));
  });

  it('leaves other text as it was', () => {
    expect(shellReceiptText('  hello ')).toBe('hello');
    expect(shellReceiptText('! ls')).toBe('!ls');
  });
});

describe('the composer hint', () => {
  it('shows for a ! line to Claude only', () => {
    expect(isShellDraft('!ls', 'claude')).toBe(true);
    expect(isShellDraft('! ls', 'claude')).toBe(true);
    expect(isShellDraft(' !ls', 'claude')).toBe(false);
    expect(isShellDraft('ls', 'claude')).toBe(false);
    expect(isShellDraft('!ls', 'codex')).toBe(false);
    expect(isShellDraft('!ls', null)).toBe(false);
  });
});

describe('a shell command in the thread', () => {
  let seq = 0;
  const message = (role: ChatMessage['role'], segments: MessageSegment[]): ChatMessage => ({
    id: `m${(seq += 1)}`, role, segments, timestamp: seq, agentLabel: null, isSidechain: false,
  });
  const input = (command: string) => message('user', [{ kind: 'shellInput', command }]);
  const output = (stdout: string, stderr = '') => message('user', [{ kind: 'shellOutput', stdout, stderr }]);
  const shells = (messages: ChatMessage[]) =>
    threadItems(messages, { showSidechain: false })
      .map((placed) => placed.item)
      .filter((item): item is ShellItem => item.kind === 'shell');

  it('is one block: the command and the output that follows it', () => {
    const command = input('git status --short');
    const items = threadItems([command, output(' M a.ts\n?? b.ts')], { showSidechain: false });
    expect(items.map((placed) => placed.item)).toEqual([{
      kind: 'shell', key: command.id, command: 'git status --short', stdout: ' M a.ts\n?? b.ts', stderr: '', running: false, timestamp: command.timestamp,
    }]);
  });

  it('keeps stderr apart', () => {
    expect(shells([input('ls /nope'), output('', 'ls: /nope: No such file')])[0]).toMatchObject({ stdout: '', stderr: 'ls: /nope: No such file' });
  });

  it('runs until its output lands', () => {
    const command = input('sleep 5');
    expect(shells([command])).toEqual([expect.objectContaining({ key: command.id, running: true, stdout: '' })]);
  });

  it('never pairs across another turn', () => {
    const agent = message('assistant', [{ kind: 'text', text: 'Done.' }]);
    const [first, second] = shells([input('ls'), agent, output('stray')]);
    expect(first).toMatchObject({ command: 'ls', running: false, stdout: '' });
    expect(second).toMatchObject({ command: null, stdout: 'stray', running: false });
    const typed = message('user', [{ kind: 'text', text: 'and this' }]);
    expect(shells([input('ls'), typed, output('stray')]).map((item) => item.command)).toEqual(['ls', null]);
  });

  it('shows an output whose command fell outside the window on its own', () => {
    const only = output('/Users/kenneth');
    expect(shells([only])).toEqual([expect.objectContaining({ key: only.id, command: null, stdout: '/Users/kenneth', running: false })]);
  });

  it('pairs two commands run back to back each with its own output', () => {
    expect(shells([input('pwd'), output('/a'), input('whoami'), output('demo')]).map((item) => [item.command, item.stdout]))
      .toEqual([['pwd', '/a'], ['whoami', 'demo']]);
  });

  it('ends a tool run before it, and keeps the conversation around it', () => {
    const items = threadItems([
      message('assistant', [{ kind: 'toolUse', name: 'Bash', input: '{command: ls}', id: 't1' }]),
      message('user', [{ kind: 'toolResult', text: 'a', toolUseId: 't1' }]),
      input('pwd'),
      output('/a'),
      message('assistant', [{ kind: 'text', text: 'ok' }]),
    ], { showSidechain: false });
    expect(items.map((placed) => placed.item.kind)).toEqual(['tools', 'shell', 'agent']);
  });

  it('reads a real transcript pair end to end', () => {
    const messages = parseTranscript([
      user('<bash-input> pwd</bash-input>', '128f0f6b'),
      user('<bash-stdout>/Users/kenneth/Dropbox/dev/azure/caret</bash-stdout><bash-stderr></bash-stderr>', '6b38f819'),
      assistant('next'),
    ].join('\n'));
    expect(shells(messages)).toEqual([expect.objectContaining({ key: '128f0f6b', command: 'pwd', stdout: '/Users/kenneth/Dropbox/dev/azure/caret' })]);
  });
});

describe('folding a long output', () => {
  it('keeps everything at or under the limit', () => {
    expect(foldShellOutput('a\nb', 'c', 3, false)).toEqual({ stdout: 'a\nb', stderr: 'c', lines: 3, hidden: 0 });
  });

  it('keeps the first lines, stdout before stderr', () => {
    expect(foldShellOutput('a\nb', 'c\nd', 3, false)).toEqual({ stdout: 'a\nb', stderr: 'c', lines: 4, hidden: 1 });
    expect(foldShellOutput('a\nb\nc\nd', 'e', 2, false)).toEqual({ stdout: 'a\nb', stderr: '', lines: 5, hidden: 3 });
  });

  it('shows it all once opened', () => {
    expect(foldShellOutput('a\nb\nc', '', 1, true)).toMatchObject({ stdout: 'a\nb\nc', hidden: 0, lines: 3 });
  });

  it('copies stdout then stderr', () => {
    expect(shellOutputText('out', 'err')).toBe('out\nerr');
    expect(shellOutputText('', 'err')).toBe('err');
  });
});
