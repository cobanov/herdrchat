import { claudeShell } from '../transcript/harness';
import { isToolOnly, receiptKey, type ChatMessage, type MessageSegment } from '../transcript/message';
import { parseTranscript, parseTranscriptLine, SHELL_OUTPUT_CUT } from '../transcript/parser';
import { previewText } from '../transcript/store';
import { foldShellOutput, isShellDraft, shellOutputText, shellReceiptText } from '../shellMode';
import { threadItems, type ShellItem } from '../threadItems';

/** A Claude user line, in the shape 2.1.286 writes for shell mode. */
const user = (content: unknown, uuid = 'u1') =>
  JSON.stringify({ type: 'user', uuid, timestamp: '2026-10-04T14:27:13.718Z', message: { role: 'user', content } });
const assistant = (text: string, uuid = 'a1') =>
  JSON.stringify({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'text', text }] } });

describe('reading shell mode', () => {
  // Measured: `! pwd` in a Claude Code 2.1.286 session on this Mac records
  // ` pwd`; other sessions on it record `ls` with no space at all.
  it('reads the command Claude records, with or without a leading space', () => {
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

  // Claude Code 2.1.296 escapes &, < and > in what a command printed. This is
  // a real line, from a `! git push --force` on this Mac.
  it('undoes Claude\'s escaping of the output', () => {
    const pushed = '<bash-stdout>To https://github.com/kballenegger/zen.git\n + f8b6c38...05049d5 main -&gt; main (forced update)</bash-stdout><bash-stderr></bash-stderr>';
    expect(claudeShell(pushed)?.output?.stdout).toBe('To https://github.com/kballenegger/zen.git\n + f8b6c38...05049d5 main -> main (forced update)');
    expect(claudeShell('<bash-stdout>a &amp;&amp; b &lt;div&gt;</bash-stdout><bash-stderr>x -&gt; y</bash-stderr>')?.output)
      .toEqual({ stdout: 'a && b <div>', stderr: 'x -> y' });
  });

  it('undoes the escaping once, so printed entities stay as printed', () => {
    expect(claudeShell('<bash-stdout>&amp;lt; &amp;amp;</bash-stdout><bash-stderr></bash-stderr>')?.output?.stdout).toBe('&lt; &amp;');
  });

  it('leaves the command as typed: Claude does not escape it', () => {
    expect(claudeShell('<bash-input>a &amp;&amp; b</bash-input>')?.command).toBe('a &amp;&amp; b');
  });

  // A large output Claude saved to a file on the host: written unescaped,
  // inside <persisted-output>, so it can even hold the closing tag.
  it('shows a persisted output\'s note and preview without its tags', () => {
    const persisted = '<persisted-output>\nOutput too large (1.2MB). Full output saved to: /tmp/x.txt\n\nPreview (first 2KB):\n1 -> a &amp; </bash-stdout> b\n2\n...\n</persisted-output>';
    expect(claudeShell(`<bash-stdout>${persisted}</bash-stdout><bash-stderr></bash-stderr>`)?.output).toEqual({
      stdout: 'Output too large (1.2MB). Full output saved to: /tmp/x.txt\n\nPreview (first 2KB):\n1 -> a &amp; </bash-stdout> b\n2\n...',
      stderr: '',
    });
  });

  it('says where an output was cut, so a copy of it is not taken as whole', () => {
    const long = 'x'.repeat(25_000);
    const segments = parseTranscriptLine(user(`<bash-stdout>${long}</bash-stdout><bash-stderr></bash-stderr>`))?.segments;
    expect(segments).toEqual([{ kind: 'shellOutput', stdout: `${'x'.repeat(20_000)}\n${SHELL_OUTPUT_CUT}`, stderr: '' }]);
    expect(SHELL_OUTPUT_CUT).toBe('[Output cut at 20,000 characters; the rest is on the host]');
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

  it.each(['!pwd', '! pwd'])('confirms %j by a record with no space before the command', (typed) => {
    const bare = parseTranscriptLine(user('<bash-input>pwd</bash-input>'))!;
    expect(receiptKey(bare)).toBe(receiptKey(echo(typed)));
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
  const message = (role: ChatMessage['role'], segments: MessageSegment[], agentLabel: string | null = null): ChatMessage => ({
    id: `m${(seq += 1)}`, role, segments, timestamp: seq, agentLabel, isSidechain: false,
  });
  const input = (command: string, agentLabel: string | null = null) => message('user', [{ kind: 'shellInput', command }], agentLabel);
  const output = (stdout: string, stderr = '', agentLabel: string | null = null) =>
    message('user', [{ kind: 'shellOutput', stdout, stderr }], agentLabel);
  const shells = (messages: ChatMessage[]) =>
    threadItems(messages, { showSidechain: false })
      .map((placed) => placed.item)
      .filter((item): item is ShellItem => item.kind === 'shell');

  it('is one block: the command and the output that follows it', () => {
    const command = input('git status --short');
    const items = threadItems([command, output(' M a.ts\n?? b.ts')], { showSidechain: false });
    expect(items.map((placed) => placed.item)).toEqual([{
      kind: 'shell', key: command.id, command: 'git status --short', stdout: ' M a.ts\n?? b.ts', stderr: '', running: false, recorded: true, timestamp: command.timestamp,
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
    expect(first).toMatchObject({ command: 'ls', running: false, recorded: false, stdout: '' });
    expect(second).toMatchObject({ command: null, stdout: 'stray', running: false });
    const typed = message('user', [{ kind: 'text', text: 'and this' }]);
    expect(shells([input('ls'), typed, output('stray')]).map((item) => item.command)).toEqual(['ls', null]);
  });

  // A workspace with two agents merges their lines as they arrive: the other
  // agent can write between a command (written when it starts) and its
  // output (written when it ends, seconds later).
  it('pairs through another agent\'s lines', () => {
    const other = message('assistant', [{ kind: 'text', text: 'working' }], 'codex');
    const command = input('sleep 5; echo done', 'claude');
    expect(shells([command, other])).toEqual([expect.objectContaining({ key: command.id, running: true })]);
    expect(shells([command, other, output('done', '', 'claude')])).toEqual([
      expect.objectContaining({ key: command.id, command: 'sleep 5; echo done', stdout: 'done', running: false, recorded: true }),
    ]);
  });

  it('pairs through a sent message\'s echo, which no transcript wrote', () => {
    const command = input('sleep 5');
    const echo: ChatMessage = { ...message('user', [{ kind: 'text', text: 'meanwhile' }]), id: 'local-1-x' };
    const items = threadItems([command, echo, output('slept')], { showSidechain: false }).map((placed) => placed.item);
    expect(items.map((item) => item.kind)).toEqual(['shell', 'user']);
    expect(items[0]).toMatchObject({ command: 'sleep 5', stdout: 'slept', recorded: true });
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
    expect(foldShellOutput('a\nb\nc\nd', '', 2, false)).toEqual({ stdout: 'a\nb', stderr: '', lines: 4, hidden: 2 });
  });

  // `! npm run build`: thirty lines of progress, then the error.
  it('never lets stdout hide stderr', () => {
    const progress = Array.from({ length: 30 }, (_, index) => `step ${index + 1}`).join('\n');
    const folded = foldShellOutput(progress, 'error TS2322: nope\n  at a.ts:1', 16, false);
    expect(folded.stdout.split('\n')).toHaveLength(14);
    expect(folded).toMatchObject({ stderr: 'error TS2322: nope\n  at a.ts:1', lines: 32, hidden: 16 });
    const loud = Array.from({ length: 40 }, (_, index) => `warn ${index + 1}`).join('\n');
    const halved = foldShellOutput(progress, loud, 16, false);
    expect([halved.stdout.split('\n').length, halved.stderr.split('\n').length]).toEqual([8, 8]);
    expect(foldShellOutput(progress, 'e', 1, false)).toMatchObject({ stdout: '', stderr: 'e' });
  });

  it('shows it all once opened', () => {
    expect(foldShellOutput('a\nb\nc', '', 1, true)).toMatchObject({ stdout: 'a\nb\nc', hidden: 0, lines: 3 });
  });

  it('copies stdout then stderr', () => {
    expect(shellOutputText('out', 'err')).toBe('out\nerr');
    expect(shellOutputText('', 'err')).toBe('err');
  });
});
