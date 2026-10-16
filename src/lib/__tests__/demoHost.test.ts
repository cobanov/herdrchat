import { HerdrClient } from '../herdr/client';
import { isConversationalAgent } from '../herdr/models';
import { DemoHost } from '../demo/host';
import {
  DEMO_AGY_SESSIONS,
  DEMO_GROK_SESSIONS,
  DEMO_SESSION_IDS,
  DEMO_WORKSPACES,
  HISTORY_DAYS,
  demoAgyPath,
  demoGrokPath,
  transcriptFor,
} from '../demo/fixtures';
import { DEMO_GIT_STATUS, DEMO_LS_OUTPUT } from '../demo/scenarios';
import { parseBlockedPrompt } from '../transcript/blockedPrompt';
import { displayText, receiptKey } from '../transcript/message';
import { parseMarkdown } from '../markdown';
import { parsePaneOverlay } from '../transcript/paneOverlay';
import { threadItems, toolRunSummary } from '../threadItems';
import { TranscriptStore } from '../transcript/store';

/** A demo workspace's transcript path, built by the real path rules. */
async function transcriptOf(host: DemoHost, index: number) {
  const store = new TranscriptStore(host);
  const home = await store.homeDirectory();
  const workspace = DEMO_WORKSPACES[index]!;
  const path = store.sessionTranscriptPath(
    home,
    workspace.cwd,
    DEMO_SESSION_IDS[workspace.paneId]!
  );
  return { store, path: path!, workspace };
}

const firstTranscript = (host: DemoHost) => transcriptOf(host, 0);

describe('DemoHost as a herdr host', () => {
  it('answers a ping, so a client can reach it at all', async () => {
    const client = new HerdrClient(new DemoHost());
    await expect(client.ping()).resolves.toBeUndefined();
  });

  it('lists workspaces, so the chat list has something to show', async () => {
    const client = new HerdrClient(new DemoHost());
    const workspaces = await client.workspaces();
    expect(workspaces.map((w) => w.label)).toEqual(['herdrchat', 'notes', 'scratch', 'ledger', 'journal', 'api', 'site', 'infra', 'docs', 'assets']);
  });

  // A workspace with two agents, each a chat of its own in the list.
  it('lists two Claude panes under the api workspace, one of them busy', async () => {
    const client = new HerdrClient(new DemoHost());
    const snapshot = await client.snapshot();
    const api = snapshot.workspaces?.find((w) => w.workspaceId === 'w6');
    // Four panes in two tabs: the two agents and a shell, then a dev server's
    // shell alone in the second tab; each shell is a terminal row in the list.
    expect(api).toMatchObject({ label: 'api', number: 6, paneCount: 4, tabCount: 2, agentStatus: 'working' });
    const agents = snapshot.agents.filter((a) => a.workspaceId === 'w6');
    expect(agents.map((a) => [a.paneId, a.agent, a.cwd, a.agentStatus, a.agentSession?.value])).toEqual([
      ['w6:p1', 'claude', '/home/demo/api', 'idle', DEMO_SESSION_IDS['w6:p1']],
      ['w6:p2', 'claude', '/home/demo/api/web', 'working', DEMO_SESSION_IDS['w6:p2']],
    ]);
    // Each titled by its own session, which titles its row and its thread.
    expect(agents.map((a) => a.title)).toEqual(['Archived projects migration', 'Save button wrap']);
    // The first five keep the one pane they always had; site's agent has a shell beside it.
    expect(snapshot.workspaces?.filter((w) => w.workspaceId !== 'w6').map((w) => w.paneCount)).toEqual([1, 1, 1, 1, 1, 2, 1, 1, 1]);
  });

  // Scratch, the OMP ledger, the Grok infra chat, the opencode docs pane and
  // the Antigravity assets chat have no session title, so the Demo also shows
  // chats titled by their workspace.
  it('titles most chats by their session, and leaves five to their workspace', async () => {
    const client = new HerdrClient(new DemoHost());
    const { agents } = await client.snapshot();
    expect(agents.map((a) => [a.paneId, a.title])).toEqual([
      ['w1:p1', 'Folder picker read errors'],
      ['w2:p1', 'Release notes summary'],
      ['w3:p1', null],
      ['w4:p1', null],
      ['w5:p1', 'Daily screen journal'],
      ['w6:p1', 'Archived projects migration'],
      ['w6:p2', 'Save button wrap'],
      ['w7:p1', 'Landing page copy'],
      ['w8:p1', null],
      ['w9:p1', null],
      ['wA:p1', null],
    ]);
  });

  it('reports one workspace as blocked, because that is the state worth seeing', async () => {
    const client = new HerdrClient(new DemoHost());
    const blocked = (await client.workspaces()).filter((w) => w.agentStatus === 'blocked');
    expect(blocked.map((w) => w.label)).toEqual(['herdrchat']);
  });
});

describe('DemoHost as a filesystem', () => {
  // The chat list's last-message line. The Demo used to answer the batch with
  // nothing, so every row read its status and a reply never reached its row
  // (regression/multi-agent could not pass).
  it("answers the chat list's preview batch, one last message per agent", async () => {
    const host = new DemoHost();
    const agents = (await new HerdrClient(host).snapshot()).agents.filter((agent) => agent.agentSession !== null);
    const previews = await new TranscriptStore(host).latestMessages(
      agents.map((agent) => ({
        workspaceId: agent.workspaceId,
        key: agent.paneId,
        cwd: agent.cwd,
        sessionId: agent.agentSession!.value,
        sessionKind: agent.agentSession!.kind,
        agent: agent.agent ?? undefined,
      }))
    );
    expect([...previews.keys()].sort()).toEqual(agents.map((agent) => agent.paneId).sort());
    expect(displayText(previews.get('w6:p1')!)).toMatch(/archived_at/);
  });

  // Grok files a session as a folder named by its id; only that exact folder is opened.
  it("finds a Grok session by its exact id and reads its ACP log as a chat", async () => {
    const host = new DemoHost();
    const grok = (await new HerdrClient(host).snapshot()).agents.find((agent) => agent.agent === 'grok')!;
    const store = new TranscriptStore(host);
    const path = await store.transcriptPath(grok);
    expect(path).toBe(demoGrokPath('/home/demo/infra', DEMO_GROK_SESSIONS['w8:p1']!));
    const { messages } = await store.recent(path!, null, 100);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'user', 'assistant']);
    const other = (value: string) => ({ ...grok, agentSession: { ...grok.agentSession!, value } });
    expect(await store.transcriptPath(other('01a13fe8-0000-7000-8000-000000000009'))).toBeNull();
    expect(await store.transcriptPath(other('../w8'))).toBeNull();
  });

  // agy files a conversation's log in a folder named by its id, under brain.
  it('finds an Antigravity conversation by its id, reads it, and answers in its format', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    const agy = (await client.snapshot()).agents.find((agent) => agent.agent === 'agy')!;
    expect(isConversationalAgent(agy)).toBe(true);
    const store = new TranscriptStore(host);
    const path = await store.transcriptPath(agy);
    expect(path).toBe(demoAgyPath(DEMO_AGY_SESSIONS['wA:p1']!));
    const { messages } = await store.recent(path!, null, 100);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(await store.transcriptPath({ ...agy, agentSession: { ...agy.agentSession!, value: '../wA' } })).toBeNull();

    await client.sendPrompt('wA:p1', 'and the 120?');
    now += 10_000;
    const after = (await store.recent(path!, null, 100)).messages;
    expect(after.slice(-2).map((message) => [message.role, displayText(message)]))
      .toEqual([['user', 'and the 120?'], ['assistant', expect.stringContaining('and the 120?')]]);
  });

  it('reports a home directory, so transcript paths can be built', async () => {
    const store = new TranscriptStore(new DemoHost());
    await expect(store.homeDirectory()).resolves.toBe('/home/demo');
  });

  it('serves a transcript the real reader turns into bubbles', async () => {
    const { store, path } = await firstTranscript(new DemoHost());
    const { messages } = await store.recent(path, 'claude', 262_144);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages[0]!.role).toBe('user');
  });

  // The demo must not quietly bypass the rule that cost a real bug: the host
  // counts UTF-8 BYTES and `String.length` counts UTF-16 units. The fixture
  // carries an emoji so this stays honest.
  it('counts bytes rather than characters', async () => {
    const { store, path, workspace } = await firstTranscript(new DemoHost());
    const text = transcriptFor(workspace.paneId);
    expect(text).toMatch(/\p{Extended_Pictographic}/u);
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(text.length);

    const probe = await store.fileProbe(path);
    expect(probe).toEqual({ kind: 'size', bytes: Buffer.byteLength(text, 'utf8') });
  });

  // The journal is longer than a thread's opening window, so the Demo can show
  // reading a long chat back to its start (regression/history.yaml).
  it('serves a long history in pages that meet without a gap', async () => {
    const { store, path } = await transcriptOf(new DemoHost(), DEMO_WORKSPACES.findIndex(w => w.label === 'journal'));
    const first = await store.recent(path, 'claude', 300);
    expect(first.startByte).toBeGreaterThan(0);
    const ids = first.messages.map(message => message.id);
    let anchor = first.startByte;
    for (let guard = 0; ; guard += 1) {
      const page = await store.older(path, 'claude', anchor, 200);
      ids.unshift(...page.messages.map(message => message.id));
      if (page.reachedStart) break;
      anchor = page.startByte;
      if (guard > 10) throw new Error('never reached the start');
    }
    expect(ids).toHaveLength(HISTORY_DAYS * 4);
    expect(ids[0]).toBe('h0-q');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says a missing transcript is absent rather than unreadable', async () => {
    const store = new TranscriptStore(new DemoHost());
    await expect(store.fileProbe('/home/demo/nope.jsonl')).resolves.toEqual({ kind: 'absent' });
  });
});

describe('DemoHost as an agent', () => {
  it('keeps replies independent when two sample chats are used together', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendKeys('w1:p1', ['1', 'Enter']);
    await client.sendPrompt('w2:p1', 'a separate conversation');
    now += 10_000;

    for (const index of [0, 1]) {
      const { store, path } = await transcriptOf(host, index);
      const { messages } = await store.recent(path, 'claude', 262_144);
      expect(messages.at(-1)?.role).toBe('assistant');
      expect(JSON.stringify(messages.at(-1)?.segments))
        .toContain(index === 0 ? 'Going ahead' : 'a separate conversation');
      expect((await client.workspaces())[index]?.agentStatus).toBe('idle');
    }
  });

  it('keeps both messages in one chat and stays working until the last reply', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', 'first message');
    now += 1_000;
    await client.sendPrompt('w2:p1', 'second message');
    now += 500;
    expect((await client.workspaces())[1]?.agentStatus).toBe('working');
    now += 1_000;
    expect((await client.workspaces())[1]?.agentStatus).toBe('idle');
    const { store, path } = await transcriptOf(host, 1);
    const { messages } = await store.recent(path, 'claude', 262_144);
    const replies = messages.filter(message => message.role === 'assistant');
    expect(JSON.stringify(replies.at(-2)?.segments)).toContain('first message');
    expect(JSON.stringify(replies.at(-1)?.segments)).toContain('second message');
  });

  it('explains that workspace management needs a real host instead of claiming success', async () => {
    const client = new HerdrClient(new DemoHost());
    for (const operation of [
      () => client.createWorkspace('/home/demo/example', 'Example'),
      () => client.renameWorkspace('w2', 'Changed'),
      () => client.closeWorkspace('w2'),
    ]) {
      await expect(operation()).rejects.toThrow('Select your own host');
    }
    expect((await client.workspaces()).map(workspace => workspace.label))
      .toEqual(['herdrchat', 'notes', 'scratch', 'ledger', 'journal', 'api', 'site', 'infra', 'docs', 'assets']);
  });

  it.each([false, true])('stops only the selected demo agent (hard: %s)', async hard => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', 'cancel this reply');
    await client.sendPrompt('w3:p1', 'keep this reply');
    await (hard ? client.interruptHard('w2:p1') : client.interrupt('w2:p1'));
    now += 10_000;
    const { store, path } = await transcriptOf(host, 1);
    expect((await store.recent(path, 'claude', 262_144)).messages.at(-1)?.role).toBe('user');
    const other = await transcriptOf(host, 2);
    expect((await other.store.recent(other.path, 'claude', 262_144)).messages.at(-1)?.role)
      .toBe('assistant');
    expect((await client.workspaces())[1]?.agentStatus).toBe('idle');
  });

  it('reports a session id per pane, so a thread can find its transcript', async () => {
    const client = new HerdrClient(new DemoHost());
    const snapshot = await client.snapshot();
    const first = snapshot.agents.find((a) => a.paneId === 'w1:p1');
    expect(first?.agentSession?.value).toBe(DEMO_SESSION_IDS['w1:p1']);
    expect(first?.agentSession?.kind).toBe('id');
  });

  it('reports a herdr version, so the client picks the modern verbs', async () => {
    const client = new HerdrClient(new DemoHost());
    await expect(client.snapshot()).resolves.toMatchObject({ version: '0.8.0' });
  });

  it('shows a numbered menu on the blocked pane, so quick replies have options', async () => {
    const client = new HerdrClient(new DemoHost());
    const screen = await client.paneVisible('w1:p1', 60);
    const prompt = parseBlockedPrompt(screen);
    expect(prompt.options.map((o) => o.number)).toEqual([1, 2]);
    expect(prompt.question).toBe('Do you want to proceed?');
  });

  // The Demo's prompt is a Bash command in Claude 2.1.299's shape at 80
  // columns, so the flow and its screenshots cover what the bar shows above
  // the question, with the wrapped command and deadline joined back up.
  it('shows what the blocked prompt would run, not only its question', async () => {
    const client = new HerdrClient(new DemoHost());
    const { details } = parseBlockedPrompt(await client.paneVisible('w1:p1', 40));
    expect(details).toMatchObject({
      title: 'Bash command',
      summary: 'Reproduce the empty-folder bug against an unreadable folder',
      deadline: '1:32',
    });
    expect(details?.body).toEqual([
      'mkdir -p /tmp/demo-unreadable && chmod 000 /tmp/demo-unreadable && npx jest src/lib/__tests__/directories.test.ts; rm -rf /tmp/demo-unreadable',
    ]);
    expect(details?.notes).toEqual([
      'This command runs rm and could not be checked',
      '⚠ Claude Code will automatically deny this request in 1:32, to avoid blocking progress on an unattended session',
    ]);
  });

  it('appends what the user sent, so their own bubble appears', async () => {
    const host = new DemoHost();
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', 'one more please');

    const { store, path } = await transcriptOf(host, 1);
    const { messages } = await store.recent(path, 'claude', 262_144);
    expect(messages.at(-1)).toMatchObject({ role: 'user' });
    expect(JSON.stringify(messages.at(-1)!.segments)).toContain('one more please');
  });

  it('unblocks the pane when the prompt is answered, so the bar goes away', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    expect((await client.workspaces())[0]!.agentStatus).toBe('blocked');

    await client.sendKeys('w1:p1', ['1', 'Enter']);
    now += 10_000;

    expect((await client.workspaces())[0]!.agentStatus).not.toBe('blocked');
    expect(await client.paneVisible('w1:p1', 60)).toBe('');
  });

  it('carries on the conversation after the prompt is answered', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    const { store, path } = await transcriptOf(host, 0);
    const before = (await store.recent(path, 'claude', 262_144)).messages.length;

    await client.sendKeys('w1:p1', ['1', 'Enter']);
    now += 10_000;

    const after = (await store.recent(path, 'claude', 262_144)).messages;
    expect(after.length).toBeGreaterThan(before);
    expect(after.at(-1)!.role).toBe('assistant');
  });

  it('streams appended lines to a live tail, so a reply lands without a refresh', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    const { store, path } = await transcriptOf(host, 1);
    const probe = await store.fileProbe(path);
    const size = probe.kind === 'size' ? probe.bytes : 0;

    await client.sendPrompt('w2:p1', 'hello there');
    now += 10_000;

    const received: string[] = [];
    for await (const line of host.streamLines(`tail -c +${size + 1} -f '${path}'`, 1_000)) {
      received.push(line);
      if (received.length === 2) break;
    }

    expect(received[0]).toContain('hello there');
    expect(received[1]).toContain('"assistant"');
  }, 15_000);

  it('replies once enough time has passed, so the agent looks alive', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', 'one more please');

    const { store, path } = await transcriptOf(host, 1);
    const before = (await store.recent(path, 'claude', 262_144)).messages;
    expect(before.at(-1)!.role).toBe('user');

    now += 10_000;
    const after = (await store.recent(path, 'claude', 262_144)).messages;
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.at(-1)!.role).toBe('assistant');
  });
});

// The Demo is also the UI tests' host: every feature needs a scenario it can
// run without SSH, read by the same parsers a real Claude screen goes through.
describe('DemoHost scenarios', () => {
  const messagesOf = async (host: DemoHost, index: number) => {
    const { store, path } = await transcriptOf(host, index);
    return (await store.recent(path, 'claude', 262_144)).messages;
  };

  it('opens /model as a panel over an idle agent, and records the pick when it closes', async () => {
    const host = new DemoHost();
    const client = new HerdrClient(host);
    await client.sendCommand('w2:p1', '/model');
    expect((await client.workspaces())[1]!.agentStatus).toBe('idle');
    const panel = parsePaneOverlay(await client.paneVisible('w2:p1', 40))!;
    expect(panel.title).toBe('Select model');
    expect(panel.options.find((o) => o.highlighted)?.number).toBe(1);

    await client.sendKeys('w2:p1', ['Down', 'Down']);
    expect(parsePaneOverlay(await client.paneVisible('w2:p1', 40))!.options.find((o) => o.highlighted)?.label).toBe('Sonnet 5');
    await client.sendKeys('w2:p1', ['s']);
    expect(parsePaneOverlay(await client.paneVisible('w2:p1', 40))).toBeNull();
    const last = (await messagesOf(host, 1)).slice(-2);
    expect(last.map((m) => [m.role, JSON.stringify(m.segments)])).toEqual([
      ['user', expect.stringContaining('/model')],
      ['system', expect.stringContaining('Set model to Sonnet 5 for this session only')],
    ]);
  });

  it('moves the /effort slider and cancels it', async () => {
    const host = new DemoHost();
    const client = new HerdrClient(host);
    await client.sendCommand('w2:p1', '/effort');
    expect(parsePaneOverlay(await client.paneVisible('w2:p1', 40))!.scale).toEqual({ levels: ['low', 'medium', 'high', 'xhigh', 'max'], current: 2 });
    await client.sendKeys('w2:p1', ['Right']);
    expect(parsePaneOverlay(await client.paneVisible('w2:p1', 40))!.scale?.current).toBe(3);
    await client.sendKeys('w2:p1', ['Escape']);
    expect(JSON.stringify((await messagesOf(host, 1)).at(-1)!.segments)).toContain('Cancelled');
  });

  it('asks two questions and a review, one screen after another, while staying blocked', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', 'Ask me two questions');
    const question = async () => parseBlockedPrompt(await client.paneVisible('w2:p1', 40)).question;
    expect((await client.workspaces())[1]!.agentStatus).toBe('blocked');
    expect(await question()).toBe('Pick a color');
    await client.sendKeys('w2:p1', ['1']);
    expect(await question()).toBe('Pick a size');
    await client.sendKeys('w2:p1', ['2']);
    expect(await question()).toBe('Ready to submit your answers?');
    expect((await client.workspaces())[1]!.agentStatus).toBe('blocked');
    await client.sendKeys('w2:p1', ['1']);
    now += 10_000;
    expect((await client.workspaces())[1]!.agentStatus).toBe('idle');
    expect(displayText((await messagesOf(host, 1)).at(-1)!)).toBe('You picked Blue and Large.');
  });

  it('asks the folder-trust question, refuses prompts meanwhile, and trusts on Down and Enter', async () => {
    const host = new DemoHost();
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', 'open a new folder');
    const pane = async () => (await client.snapshot()).agents.find((agent) => agent.paneId === 'w2:p1')!;
    expect([(await pane()).agentStatus, (await pane()).inputPending]).toEqual(['idle', true]);
    await expect(client.sendPrompt('w2:p1', 'hello?')).rejects.toMatchObject({ code: 'agent_input_pending' });

    const prompt = parseBlockedPrompt(await client.paneVisible('w2:p1', 40));
    const yes = prompt.options.find((option) => option.label === 'Yes, I trust this folder')!;
    expect(prompt.question).toContain('/home/demo/youtube');
    await client.sendKeys('w2:p1', yes.keys!);
    expect((await pane()).inputPending).toBe(false);
    expect(displayText((await messagesOf(host, 1)).at(-1)!)).toContain('I can work in this folder now');
  });

  it('replies with a table whose every row has a cell per column', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', 'compare the options for me');
    now += 10_000;
    const reply = displayText((await messagesOf(host, 1)).at(-1)!);
    const table = parseMarkdown(reply).find((block) => block.kind === 'table');
    expect(table).toMatchObject({ headers: ['Option', 'Setup', 'Latency (ms)', 'Notes'], align: [null, null, 'right', null] });
    expect(table?.kind === 'table' && table.rows.at(-1)).toEqual(['Relay', 'none', '140', 'Push only, never chat: `watcher | relay | APNs`.']);
  });

  it('runs a set of checks as tool calls with one failure', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', 'run the checks please');
    now += 10_000;
    const items = threadItems(await messagesOf(host, 1), { showSidechain: false });
    const run = items.find((placed) => placed.item.kind === 'tools')!.item;
    expect(run.kind === 'tools' && toolRunSummary(run.calls, run.thoughts.length)).toBe('Ran 2 commands · edited 1 file · read 1 file · 1 failed');
    expect(items.at(-1)!.item.kind).toBe('agent');
  });

  it('opens the notes chat with a ! command and its two lines of output', async () => {
    const items = threadItems(await messagesOf(new DemoHost(), 1), { showSidechain: false });
    const shell = items.map((placed) => placed.item).find((item) => item.kind === 'shell');
    expect(shell).toMatchObject({ key: 'd2-0g', command: DEMO_GIT_STATUS.command, stdout: DEMO_GIT_STATUS.stdout, stderr: '', running: false });
    expect(DEMO_GIT_STATUS.stdout.split('\n')).toHaveLength(2);
  });

  it('runs a sent ! line in its shell: the command at once, its listing a beat later', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendPrompt('w2:p1', '! ls');
    const shellOf = async () => threadItems(await messagesOf(host, 1), { showSidechain: false }).at(-1)!.item;
    const sent = await shellOf();
    expect(sent).toMatchObject({ kind: 'shell', command: 'ls', running: true });
    // The echo of `! ls` is confirmed by what was recorded.
    const recorded = (await messagesOf(host, 1)).at(-1)!;
    expect(receiptKey(recorded)).toBe(receiptKey({ ...recorded, segments: [{ kind: 'text', text: '! ls' }] }));

    now += 10_000;
    expect(await shellOf()).toMatchObject({ kind: 'shell', command: 'ls', running: false, stdout: DEMO_LS_OUTPUT, stderr: '' });
    expect(DEMO_LS_OUTPUT.split('\n')).toHaveLength(3);
    // The model never saw it, so the agent never answered it.
    expect((await client.agents()).find((agent) => agent.paneId === 'w2:p1')?.agentStatus).toBe('idle');
  });

  it('says on stderr that any other ! line did not run', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    await new HerdrClient(host).sendPrompt('w2:p1', '!rm -rf /');
    now += 10_000;
    const last = threadItems(await messagesOf(host, 1), { showSidechain: false }).at(-1)!.item;
    expect(last).toMatchObject({ kind: 'shell', command: 'rm -rf /', stdout: '' });
    expect(last.kind === 'shell' && last.stderr).toMatch(/nothing ran/);
  });
});

// OMP reports its journal's path, and the real OMP reader and header check read it.
describe('DemoHost as an OMP host', () => {
  it('reports the journal path, which the store verifies and reads as OMP', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    const agent = (await client.agents()).find((a) => a.agent === 'omp')!;
    expect(agent.agentSession).toMatchObject({ kind: 'path' });
    const store = new TranscriptStore(host);
    const path = (await store.ompTranscriptPath(agent.agentSession!.value!, 'path'))!;
    await expect(store.verifyOmpTranscript(path, null)).resolves.toBeUndefined();
    const before = (await store.recent(path, 'omp', 262_144)).messages;
    const items = threadItems(before, { showSidechain: false });
    expect(items.map((placed) => placed.item.kind)).toEqual(['user', 'tools', 'agent']);

    await client.sendPrompt(agent.paneId, 'and february?');
    now += 10_000;
    const after = (await store.recent(path, 'omp', 262_144)).messages;
    expect(after.slice(-2).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(displayText(after.at(-2)!)).toBe('and february?');
  });
});

describe('DemoHost with two agents in one workspace', () => {
  async function paneTranscript(host: DemoHost, paneId: string, cwd: string) {
    const store = new TranscriptStore(host);
    const path = store.sessionTranscriptPath(await store.homeDirectory(), cwd, DEMO_SESSION_IDS[paneId]!)!;
    return async () => (await store.recent(path, 'claude', 262_144)).messages;
  }

  it('keeps a separate transcript for each pane', async () => {
    const host = new DemoHost();
    const p1 = await (await paneTranscript(host, 'w6:p1', '/home/demo/api'))();
    const p2 = await (await paneTranscript(host, 'w6:p2', '/home/demo/api/web'))();
    expect(JSON.stringify(p1)).toContain('migration');
    expect(JSON.stringify(p1)).not.toContain('save button');
    expect(JSON.stringify(p2)).toContain('save button');
    expect(JSON.stringify(p2)).not.toContain('migration');
  });

  it('echoes a message sent to one pane into that pane only', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    const p1 = await paneTranscript(host, 'w6:p1', '/home/demo/api');
    const p2 = await paneTranscript(host, 'w6:p2', '/home/demo/api/web');
    const before = (await p1()).length;

    await client.sendPrompt('w6:p2', 'centre the icon too');
    now += 10_000;

    expect(JSON.stringify(await p2())).toContain('centre the icon too');
    expect((await p2()).at(-1)?.role).toBe('assistant');
    expect(await p1()).toHaveLength(before);
    expect(JSON.stringify(await p1())).not.toContain('centre the icon too');
  });

  it('leaves the five single-agent transcripts as they were', () => {
    for (const workspace of DEMO_WORKSPACES.slice(0, 5)) {
      expect(workspace.morePanes).toBeUndefined();
    }
    expect(transcriptFor('w6:p1')).not.toBe(transcriptFor('w6:p2'));
  });
});

// The layout view draws the Demo's w6 as two tabs: its agents side by side
// with the shell under the first, then a dev server alone. w2 is one pane.
describe("the Demo's tabs and layouts", () => {
  it('sends a tab and a layout for each tab, the panes where they sit', async () => {
    const snapshot = await new HerdrClient(new DemoHost()).snapshot();
    expect(snapshot.tabs?.filter((tab) => tab.workspaceId === 'w6').map((tab) => [tab.tabId, tab.number, tab.label, tab.paneCount])).toEqual([
      ['w6:t1', 1, 'api', 3], ['w6:t2', 2, 'server', 1],
    ]);
    const w6 = snapshot.layouts?.filter((layout) => layout.workspaceId === 'w6') ?? [];
    expect(w6.map((layout) => layout.panes.map((pane) => [pane.paneId, pane.rect.x, pane.rect.y, pane.rect.width, pane.rect.height]))).toEqual([
      [['w6:p1', 0, 0, 80, 32], ['w6:p3', 0, 32, 80, 16], ['w6:p2', 80, 0, 80, 48]],
      [['w6:p4', 0, 0, 160, 48]],
    ]);
    expect(w6[0]?.focusedPaneId).toBe('w6:p2');
    expect(snapshot.panes.find((pane) => pane.paneId === 'w6:p4')).toMatchObject({ tabId: 'w6:t2', title: 'npm run dev' });
    expect(snapshot.workspaces?.find((w) => w.workspaceId === 'w6')).toMatchObject({ tabCount: 2, activeTabId: 'w6:t1' });
    const w2 = snapshot.layouts?.filter((layout) => layout.workspaceId === 'w2') ?? [];
    expect(w2.map((layout) => layout.panes.map((pane) => pane.paneId))).toEqual([['w2:p1']]);
    expect(snapshot.tabs?.find((tab) => tab.workspaceId === 'w2')).toMatchObject({ label: 'notes', paneCount: 1 });
  });
});
