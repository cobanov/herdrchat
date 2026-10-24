import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { HerdrClient } from '../herdr/client';
import type { HerdrTransport } from '../herdr/transport';
import { DemoHost } from '../demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '../demo/fixtures';
import { DEMO_HEADSUP_PATH, DEMO_HEADSUP_REPLY, DEMO_PHRASES } from '../demo/scenarios';
import { displayText } from '../transcript/message';
import { TranscriptStore } from '../transcript/store';
import { HEADSUP_CLEANUP_SCRIPT, HEADSUP_MAX_BYTES, HEADSUP_PART_NEXT_SCRIPT, HEADSUP_SWAP_SCRIPT } from '../headsup/command';
import {
  changeHeadsUp,
  detectHeadsUp,
  headsUpDetectDue,
  headsUpReadDue,
  HEADSUP_DETECT_INTERVAL_MS,
  HEADSUP_READ_INTERVAL_MS,
  readHeadsUp,
  writeHeadsUp,
  type HeldStore,
} from '../headsup/client';
import { parseHeadsUpFile, resolveItem, markReplied, summary } from '../headsup/items';

/** A host whose clock the test moves, so the agent's reply lands on demand. */
function demo() {
  let now = Date.parse('2026-10-24T12:00:00Z');
  const host = new DemoHost(() => now);
  return { host, advance: (ms: number) => { now += ms; } };
}

async function held(transport: HerdrTransport): Promise<HeldStore> {
  const found = await detectHeadsUp(transport);
  if (found?.kind !== 'found') throw new Error('no store');
  const read = await readHeadsUp(transport, found.path, null);
  if (read?.kind !== 'present') throw new Error('no read');
  return { path: found.path, version: read.version, file: parseHeadsUpFile(read.text)! };
}

const token = () => 'tok';

describe('the cadence', () => {
  it('looks for the mod every ten minutes and reads it every ten seconds', () => {
    expect(headsUpDetectDue(null, 5)).toBe(true);
    expect(headsUpDetectDue(0, HEADSUP_DETECT_INTERVAL_MS - 1)).toBe(false);
    expect(headsUpDetectDue(0, HEADSUP_DETECT_INTERVAL_MS)).toBe(true);
    expect(headsUpReadDue(null, 5)).toBe(true);
    expect(headsUpReadDue(0, HEADSUP_READ_INTERVAL_MS - 1)).toBe(false);
    expect(headsUpReadDue(0, HEADSUP_READ_INTERVAL_MS)).toBe(true);
  });
});

describe('the Demo host’s Heads Up', () => {
  it('has none until it is set up, so every other flow looks as it always has', async () => {
    const { host } = demo();
    await expect(detectHeadsUp(host)).resolves.toEqual({ kind: 'none' });
    await expect(readHeadsUp(host, DEMO_HEADSUP_PATH, null)).resolves.toEqual({ kind: 'missing' });
  });

  it('plays an agent setting it up, with one of each kind from the chat and from billing', async () => {
    const { host, advance } = demo();
    await new HerdrClient(host).sendPrompt('w2:p1', `please ${DEMO_PHRASES.headsUp}`);
    advance(5_000);
    const store = await held(host);
    expect(store.path).toBe(DEMO_HEADSUP_PATH);
    expect(summary(store.file.items)).toBe('2 questions · 1 follow-up · 1 failure · 1 note');
    const notes = DEMO_SESSION_IDS['w2:p1'];
    const blocking = store.file.items.find((item) => item.blocking);
    expect(blocking).toMatchObject({ kind: 'question', sessionId: notes, folder: 'notes' });
    expect(store.file.items.find((item) => item.folder === 'billing')?.detail).toMatch(/rounds per line/);
    // The item of a kind this app does not know is in the file, not in the list.
    expect((store.file.raw.items as unknown[]).length).toBe(6);

    const transcripts = new TranscriptStore(host);
    const workspace = DEMO_WORKSPACES[1]!;
    const path = transcripts.sessionTranscriptPath(await transcripts.homeDirectory(), workspace.cwd, notes!);
    const messages = (await transcripts.recent(path!, 'claude', 262_144)).messages;
    expect(displayText(messages.at(-1)!)).toBe(DEMO_HEADSUP_REPLY);
  });

  it('reads an unchanged store as one line', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    await expect(readHeadsUp(host, store.path, store.version)).resolves.toEqual({ kind: 'unchanged' });
  });
});

describe('changeHeadsUp', () => {
  it('writes a change against the version read, keeping what it does not know', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    const result = await changeHeadsUp(host, store, resolveItem('demohu5n', 99), token);
    expect(result).toMatchObject({ ok: true, changed: true });
    const after = JSON.parse(host.headsUpText()!) as { items: Record<string, unknown>[]; lastPrunedAt: number };
    expect(after.items.find((item) => item.id === 'demohu5n')).toMatchObject({ status: 'done', doneAt: 99 });
    expect(after.items.find((item) => item.id === 'demohu6r')).toMatchObject({ kind: 'reminder', status: 'open' });
    expect(typeof after.lastPrunedAt).toBe('number');
    // What the app now holds is what the host has, at its new version.
    expect(result.held?.version).not.toBe(store.version);
    await expect(readHeadsUp(host, store.path, result.held!.version)).resolves.toEqual({ kind: 'unchanged' });
  });

  it('reads again and retries once when a session wrote the file in between', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    host.touchHeadsUp();
    const result = await changeHeadsUp(host, store, markReplied('demohu1q', 7), token);
    expect(result.ok).toBe(true);
    const after = JSON.parse(host.headsUpText()!) as { items: Record<string, unknown>[] };
    expect(after.items.find((item) => item.id === 'demohu1q')).toMatchObject({ repliedAt: 7, status: 'open' });
  });

  it('gives up when the file changes under both tries, and writes nothing', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    // Another session writes just before every swap.
    const racing: HerdrTransport = {
      exec: (command, timeoutMs) => {
        if (command.includes(HEADSUP_SWAP_SCRIPT.split('\n')[0]!)) host.touchHeadsUp();
        return host.exec(command, timeoutMs);
      },
      streamLines: (command, timeoutMs) => host.streamLines(command, timeoutMs),
    };
    const result = await changeHeadsUp(racing, store, resolveItem('demohu5n', 1), token);
    expect(result.ok).toBe(false);
    expect(JSON.parse(host.headsUpText()!).items.find((item: { id: string }) => item.id === 'demohu5n')).toMatchObject({ status: 'open' });
  });

  it('does nothing, and says it worked, when there is nothing to change', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    const exec = jest.spyOn(host, 'exec');
    await expect(changeHeadsUp(host, store, resolveItem('gone', 1), token)).resolves.toEqual({ ok: true, changed: false, held: store });
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails, never throws, when the host cannot be reached', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    const down: HerdrTransport = {
      exec: async (): Promise<ExecResult> => ({ ok: false, code: 'timeout', message: 'no' }),
      streamLines: (command, timeoutMs) => host.streamLines(command, timeoutMs),
    };
    await expect(changeHeadsUp(down, store, resolveItem('demohu5n', 1), token)).resolves.toEqual({ ok: false, held: store });
    const throwing: HerdrTransport = { ...down, exec: async () => { throw new Error('boom'); } };
    await expect(detectHeadsUp(throwing)).resolves.toBeNull();
    await expect(readHeadsUp(throwing, DEMO_HEADSUP_PATH, null)).resolves.toBeNull();
  });

  it('says nothing changed when a fresh read finds the item already as asked', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    // The terminal replies first: the app's copy is now old.
    const other = await changeHeadsUp(host, store, markReplied('demohu1q', 1), token);
    expect(other).toMatchObject({ ok: true, changed: true });
    const result = await changeHeadsUp(host, store, markReplied('demohu1q', 2), token);
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result.held?.file.items.find((item) => item.id === 'demohu1q')?.repliedAt).toBe(1);
  });

  it('fails, never throws, when given a path, version or token no host could take', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    await expect(readHeadsUp(host, '/etc/passwd', null)).resolves.toBeNull();
    await expect(writeHeadsUp(host, store.path, 'not a version', { items: [] }, 'tok')).resolves.toBeNull();
    await expect(writeHeadsUp(host, store.path, store.version, { items: [] }, 'bad token')).resolves.toBeNull();
    await expect(changeHeadsUp(host, store, resolveItem('demohu5n', 1), () => 'bad token')).resolves.toMatchObject({ ok: false });
  });

  it('removes the temp file when a piece of a large write does not go', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    const sent: string[] = [];
    let pieces = 0;
    const flaky: HerdrTransport = {
      exec: async (command, timeoutMs) => {
        sent.push(command);
        if (command.includes(HEADSUP_PART_NEXT_SCRIPT) && ++pieces === 1) return { ok: false, code: 'timeout', message: 'no' };
        return host.exec(command, timeoutMs);
      },
      streamLines: (command, timeoutMs) => host.streamLines(command, timeoutMs),
    };
    const big = { items: Array.from({ length: 700 }, (_, index) => ({ id: `i${index}`, text: 'x'.repeat(200) })) };
    await expect(writeHeadsUp(flaky, store.path, store.version, big, 'tok')).resolves.toBeNull();
    await Promise.resolve();
    expect(sent.at(-1)).toContain(HEADSUP_CLEANUP_SCRIPT);
    expect(sent.at(-1)).toContain(`${store.path}.herdrchat-tok.tmp`);
    expect(sent.some((command) => command.includes(HEADSUP_SWAP_SCRIPT.split('\n')[0]!))).toBe(false);
  });

  it('refuses to write a file past the cap', async () => {
    const { host } = demo();
    host.setUpHeadsUp('w2:p1');
    const store = await held(host);
    const exec = jest.spyOn(host, 'exec');
    await expect(writeHeadsUp(host, store.path, store.version, { pad: 'x'.repeat(HEADSUP_MAX_BYTES) }, 'tok')).resolves.toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});
