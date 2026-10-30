import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { HerdrClient } from '../herdr/client';
import type { HerdrTransport } from '../herdr/transport';
import { DemoHost } from '../demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '../demo/fixtures';
import { DEMO_PHRASES, DEMO_YSK_ELSEWHERE, DEMO_YSK_LINE, DEMO_YSK_PATH, DEMO_YSK_REPLY, DEMO_YSK_UNKNOWN_KEY } from '../demo/scenarios';
import { displayText } from '../transcript/message';
import { TranscriptStore } from '../transcript/store';
import { YSK_CLEANUP_SCRIPT, YSK_MAX_BYTES, YSK_PART_NEXT_SCRIPT, YSK_SWAP_SCRIPT } from '../youShouldKnow/command';
import {
  changeYouShouldKnow,
  detectYouShouldKnow,
  readYouShouldKnow,
  writeYouShouldKnow,
  YSK_DETECT_INTERVAL_MS,
  YSK_READ_INTERVAL_MS,
  yskDetectDue,
  yskReadDue,
  type HeldStore,
} from '../youShouldKnow/client';
import { dismissNote, knowNote, parseYskFile, type Note } from '../youShouldKnow/notes';

/** A host whose clock the test moves, so the agent's reply lands on demand. */
function demo() {
  let now = Date.parse('2026-10-24T12:00:00Z');
  const host = new DemoHost(() => now);
  return { host, advance: (ms: number) => { now += ms; } };
}

async function held(transport: HerdrTransport): Promise<HeldStore> {
  const found = await detectYouShouldKnow(transport);
  if (found?.kind !== 'found') throw new Error('no store');
  const read = await readYouShouldKnow(transport, found.path, null);
  if (read?.kind !== 'present') throw new Error('no read');
  return { path: found.path, version: read.version, file: parseYskFile(read.text)! };
}

const NOTES = DEMO_SESSION_IDS['w2:p1']!;
const noteOf = (store: HeldStore, sessionId: string): Note => store.file.notes.find((note) => note.sessionId === sessionId)!;
const onHost = (host: DemoHost) => JSON.parse(host.yskText()!) as { sessions: Record<string, unknown>[]; known: string[] } & Record<string, unknown>;
const token = () => 'tok';

describe('the cadence', () => {
  it('looks for the plugin every ten minutes and reads it every ten seconds', () => {
    expect(yskDetectDue(null, 5)).toBe(true);
    expect(yskDetectDue(0, YSK_DETECT_INTERVAL_MS - 1)).toBe(false);
    expect(yskDetectDue(0, YSK_DETECT_INTERVAL_MS)).toBe(true);
    expect(yskReadDue(null, 5)).toBe(true);
    expect(yskReadDue(0, YSK_READ_INTERVAL_MS - 1)).toBe(false);
    expect(yskReadDue(0, YSK_READ_INTERVAL_MS)).toBe(true);
  });
});

describe('the Demo host’s "You should know"', () => {
  it('has none until its agent has a note, so every other flow looks as it always has', async () => {
    const { host } = demo();
    await expect(detectYouShouldKnow(host)).resolves.toEqual({ kind: 'none' });
    await expect(readYouShouldKnow(host, DEMO_YSK_PATH, null)).resolves.toEqual({ kind: 'missing' });
  });

  it('plays an agent offering a note to its chat, beside another session’s', async () => {
    const { host, advance } = demo();
    await new HerdrClient(host).sendPrompt('w2:p1', `please ${DEMO_PHRASES.note}`);
    advance(5_000);
    const store = await held(host);
    expect(store.path).toBe(DEMO_YSK_PATH);
    expect(store.file.notes.map((note) => [note.sessionId, note.tag, note.view.kind])).toEqual([
      [NOTES, 'Heads up', 'offer'],
      [DEMO_YSK_ELSEWHERE, 'You should know', 'explained'],
    ]);
    expect(noteOf(store, NOTES).view.line).toBe(DEMO_YSK_LINE);
    // The row showing nothing is in the file, not among the notes.
    expect((store.file.raw.sessions as unknown[]).length).toBe(3);

    const transcripts = new TranscriptStore(host);
    const workspace = DEMO_WORKSPACES[1]!;
    const path = transcripts.sessionTranscriptPath(await transcripts.homeDirectory(), workspace.cwd, NOTES);
    const messages = (await transcripts.recent(path!, 'claude', 262_144)).messages;
    expect(displayText(messages.at(-1)!)).toBe(DEMO_YSK_REPLY);
  });

  it('reads an unchanged store as one line', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    await expect(readYouShouldKnow(host, store.path, store.version)).resolves.toEqual({ kind: 'unchanged' });
  });
});

describe('changeYouShouldKnow', () => {
  it('writes a change against the version read, keeping what it does not know', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    const result = await changeYouShouldKnow(host, store, knowNote(noteOf(store, NOTES)), token);
    expect(result).toMatchObject({ ok: true, changed: true });
    const after = onHost(host);
    expect(after.sessions[0]).not.toHaveProperty('view');
    expect(after.sessions[0]).toMatchObject({ id: NOTES, tag: 'Heads up', askedTurn: 6 });
    expect(after.known).toEqual([DEMO_YSK_LINE]);
    expect(after[DEMO_YSK_UNKNOWN_KEY]).toEqual({ kept: true });
    expect(after).toMatchObject({ typedPastInARow: 0, looksToSkip: 0 });
    // What the app now holds is what the host has, at its new version.
    expect(result.held?.version).not.toBe(store.version);
    expect(result.held?.file.notes.map((note) => note.sessionId)).toEqual([DEMO_YSK_ELSEWHERE]);
    await expect(readYouShouldKnow(host, store.path, result.held!.version)).resolves.toEqual({ kind: 'unchanged' });
  });

  it('reads again and retries once when the terminal wrote the file in between', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    host.rejectNextNoteWrite();
    const result = await changeYouShouldKnow(host, store, dismissNote(noteOf(store, DEMO_YSK_ELSEWHERE)), token);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(onHost(host).sessions[1]).not.toHaveProperty('view');
  });

  it('gives up when the file changes under both tries, and writes nothing', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    // The terminal writes just before every swap.
    const racing: HerdrTransport = {
      exec: (command, timeoutMs) => {
        if (command.includes(YSK_SWAP_SCRIPT.split('\n')[0]!)) host.touchNotes();
        return host.exec(command, timeoutMs);
      },
      streamLines: (command, timeoutMs) => host.streamLines(command, timeoutMs),
    };
    const result = await changeYouShouldKnow(racing, store, dismissNote(noteOf(store, NOTES)), token);
    expect(result.ok).toBe(false);
    expect(onHost(host).sessions[0]).toHaveProperty('view');
  });

  it('does nothing, and says it worked, when the note is already gone', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    const gone = { ...noteOf(store, NOTES), sessionId: 'not-a-session' };
    const exec = jest.spyOn(host, 'exec');
    await expect(changeYouShouldKnow(host, store, dismissNote(gone), token)).resolves.toEqual({ ok: true, changed: false, held: store });
    expect(exec).not.toHaveBeenCalled();
  });

  it('says nothing changed when a fresh read finds the terminal already took the note away', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    const note = noteOf(store, NOTES);
    // Dismissed at the computer first: the app's copy is now old.
    await expect(changeYouShouldKnow(host, store, dismissNote(note), token)).resolves.toMatchObject({ ok: true, changed: true });
    const result = await changeYouShouldKnow(host, store, knowNote(note), token);
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(onHost(host).known).toEqual([]);
  });

  it('fails, never throws, when the host cannot be reached', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    const down: HerdrTransport = {
      exec: async (): Promise<ExecResult> => ({ ok: false, code: 'timeout', message: 'no' }),
      streamLines: (command, timeoutMs) => host.streamLines(command, timeoutMs),
    };
    await expect(changeYouShouldKnow(down, store, dismissNote(noteOf(store, NOTES)), token)).resolves.toEqual({ ok: false, held: store });
    const throwing: HerdrTransport = { ...down, exec: async () => { throw new Error('boom'); } };
    await expect(detectYouShouldKnow(throwing)).resolves.toBeNull();
    await expect(readYouShouldKnow(throwing, DEMO_YSK_PATH, null)).resolves.toBeNull();
  });

  it('fails, never throws, when given a path, version or token no host could take', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    await expect(readYouShouldKnow(host, '/etc/passwd', null)).resolves.toBeNull();
    await expect(writeYouShouldKnow(host, store.path, 'not a version', { sessions: [] }, 'tok')).resolves.toBeNull();
    await expect(writeYouShouldKnow(host, store.path, store.version, { sessions: [] }, 'bad token')).resolves.toBeNull();
    await expect(changeYouShouldKnow(host, store, dismissNote(noteOf(store, NOTES)), () => 'bad token')).resolves.toMatchObject({ ok: false });
  });

  it('removes the part file when a piece of a large write does not go', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    const sent: string[] = [];
    let pieces = 0;
    const flaky: HerdrTransport = {
      exec: async (command, timeoutMs) => {
        sent.push(command);
        if (command.includes(YSK_PART_NEXT_SCRIPT) && ++pieces === 1) return { ok: false, code: 'timeout', message: 'no' };
        return host.exec(command, timeoutMs);
      },
      streamLines: (command, timeoutMs) => host.streamLines(command, timeoutMs),
    };
    const big = { sessions: Array.from({ length: 700 }, (_, index) => ({ id: `s${index}`, note: 'x'.repeat(200) })) };
    await expect(writeYouShouldKnow(flaky, store.path, store.version, big, 'tok')).resolves.toBeNull();
    await Promise.resolve();
    expect(sent.at(-1)).toContain(YSK_CLEANUP_SCRIPT);
    expect(sent.at(-1)).toContain(`${store.path}.herdrchat-tok.b64`);
    expect(sent.some((command) => command.includes(YSK_SWAP_SCRIPT.split('\n')[0]!))).toBe(false);
  });

  it('refuses to write a file past the cap', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const store = await held(host);
    const exec = jest.spyOn(host, 'exec');
    await expect(writeYouShouldKnow(host, store.path, store.version, { pad: 'x'.repeat(YSK_MAX_BYTES) }, 'tok')).resolves.toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});
