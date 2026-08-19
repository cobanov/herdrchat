import { HerdrClient } from '../herdr/client';
import { DemoHost } from '../demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES, transcriptFor } from '../demo/fixtures';
import { parseBlockedPrompt } from '../transcript/blockedPrompt';
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
    expect(workspaces.map((w) => w.label)).toEqual(['herdrchat', 'notes', 'scratch']);
  });

  it('reports one workspace as blocked, because that is the state worth seeing', async () => {
    const client = new HerdrClient(new DemoHost());
    const blocked = (await client.workspaces()).filter((w) => w.agentStatus === 'blocked');
    expect(blocked.map((w) => w.label)).toEqual(['herdrchat']);
  });
});

describe('DemoHost as a filesystem', () => {
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

  it('says a missing transcript is absent rather than unreadable', async () => {
    const store = new TranscriptStore(new DemoHost());
    await expect(store.fileProbe('/home/demo/nope.jsonl')).resolves.toEqual({ kind: 'absent' });
  });
});

describe('DemoHost as an agent', () => {
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
    expect(prompt.question).toContain('go ahead');
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
