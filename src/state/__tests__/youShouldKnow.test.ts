import { DemoHost } from '@/lib/demo/host';
import { DEMO_SESSION_IDS } from '@/lib/demo/fixtures';
import { DEMO_YSK_ELSEWHERE, DEMO_YSK_LINE, DEMO_YSK_PATH, DEMO_YSK_UNKNOWN_KEY } from '@/lib/demo/scenarios';
import { readYouShouldKnow, YSK_DETECT_INTERVAL_MS } from '@/lib/youShouldKnow/client';
import { YSK_SWAP_SCRIPT } from '@/lib/youShouldKnow/command';
import { dismissNote, knowNote, learnMore, type Note } from '@/lib/youShouldKnow/notes';
import {
  changeHostNotes,
  checkYouShouldKnow,
  notesOf,
  resetYouShouldKnowSession,
  setNoteChats,
  useYouShouldKnow,
} from '../youShouldKnow';

const T0 = Date.parse('2026-10-24T12:00:00Z');
const NOTES = DEMO_SESSION_IDS['w2:p1']!;

function demo() {
  const host = new DemoHost(() => T0);
  const exec = jest.spyOn(host, 'exec');
  return { host, exec };
}

const noteOf = (sessionId: string): Note => notesOf('demo').file!.notes.find((note) => note.sessionId === sessionId)!;

beforeEach(() => resetYouShouldKnowSession());

describe('checkYouShouldKnow', () => {
  it('on a host without the plugin looks once, holds nothing, and looks again only on the cadence', async () => {
    const { host, exec } = demo();
    await checkYouShouldKnow('demo', host, { now: T0 });
    expect(notesOf('demo')).toMatchObject({ path: null, file: null, detectedAt: T0 });
    expect(exec).toHaveBeenCalledTimes(1);
    await checkYouShouldKnow('demo', host, { now: T0 + 10_000 });
    expect(exec).toHaveBeenCalledTimes(1);
    await checkYouShouldKnow('demo', host, { now: T0 + YSK_DETECT_INTERVAL_MS });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('notices the plugin turned on later when asked to look (a pull), and reads its notes', async () => {
    const { host } = demo();
    await checkYouShouldKnow('demo', host, { now: T0 });
    host.setUpNotes('w2:p1');
    await checkYouShouldKnow('demo', host, { now: T0 + 10_000 });
    expect(notesOf('demo').path).toBeNull();
    await checkYouShouldKnow('demo', host, { now: T0 + 20_000, detect: true });
    expect(notesOf('demo').path).toBe(DEMO_YSK_PATH);
    expect(notesOf('demo').file?.notes).toHaveLength(2);
  });

  it('reads unchanged notes without replacing what it holds', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    await checkYouShouldKnow('demo', host, { now: T0 });
    const before = useYouShouldKnow.getState().byConnection;
    await checkYouShouldKnow('demo', host, { now: T0 + 10_000 });
    expect(useYouShouldKnow.getState().byConnection).toBe(before);
  });

  it('drops an answer for a host removed while it was out', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    const check = checkYouShouldKnow('demo', host, { now: T0 });
    useYouShouldKnow.getState().clear('demo');
    await check;
    expect(useYouShouldKnow.getState().byConnection.demo).toBeUndefined();
  });

  it('looks for the store when a pull asks during a check that does not look', async () => {
    const { host } = demo();
    await checkYouShouldKnow('demo', host, { now: T0 });
    host.setUpNotes('w2:p1');
    // The poll's check is out; a pull lands before it answers.
    const poll = checkYouShouldKnow('demo', host, { now: T0 + 10_000 });
    const pull = checkYouShouldKnow('demo', host, { now: T0 + 10_000, detect: true });
    await Promise.all([poll, pull]);
    expect(notesOf('demo').path).toBe(DEMO_YSK_PATH);
  });

  it('drops a read that a write overtook, so a dismissed note never comes back', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    await checkYouShouldKnow('demo', host, { now: T0 });
    // The terminal writes; the poll's read sees that, but its answer is slow.
    host.touchNotes();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let holding = true;
    const slow = {
      exec: async (command: string, timeoutMs: number) => {
        const result = await host.exec(command, timeoutMs);
        if (holding && command.includes('c=$(mktemp)')) {
          holding = false;
          await gate;
        }
        return result;
      },
      streamLines: host.streamLines.bind(host),
    };
    const check = checkYouShouldKnow('demo', slow, { now: T0 + 10_000 });
    // Meanwhile the person dismisses the note: stale, read again, written.
    await expect(changeHostNotes('demo', host, dismissNote(noteOf(NOTES)))).resolves.toBe('changed');
    release();
    await check;
    expect(notesOf('demo').file?.notes.map((note) => note.sessionId)).toEqual([DEMO_YSK_ELSEWHERE]);
  });

  it('never rejects, and keeps what it has, when the host is down', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    await checkYouShouldKnow('demo', host, { now: T0 });
    const held = notesOf('demo');
    const down = { exec: async () => { throw new Error('gone'); }, streamLines: host.streamLines.bind(host) };
    await expect(checkYouShouldKnow('demo', down, { now: T0 + 10_000, detect: true })).resolves.toBeUndefined();
    expect(notesOf('demo')).toEqual(held);
  });
});

describe('changeHostNotes', () => {
  it('learns more, then understands, keeping the rows’ other fields and the file’s other keys', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    await checkYouShouldKnow('demo', host, { now: T0 });

    const offer = noteOf(NOTES);
    await expect(changeHostNotes('demo', host, learnMore(offer, T0 + 5)!)).resolves.toBe('changed');
    expect(noteOf(NOTES).view).toMatchObject({ kind: 'explained', line: DEMO_YSK_LINE, shownAt: T0 + 5 });
    // A second tap on the offer finds it explained already: nothing written, and it says so.
    await expect(changeHostNotes('demo', host, learnMore(offer, T0 + 6)!)).resolves.toBe('unchanged');

    await expect(changeHostNotes('demo', host, knowNote(noteOf(NOTES)))).resolves.toBe('changed');
    await expect(changeHostNotes('demo', host, dismissNote(noteOf(DEMO_YSK_ELSEWHERE)))).resolves.toBe('changed');
    expect(notesOf('demo').file?.notes).toEqual([]);

    const raw = notesOf('demo').file!.raw;
    expect(raw).toMatchObject({ known: [DEMO_YSK_LINE], typedPastInARow: 0, looksToSkip: 0, [DEMO_YSK_UNKNOWN_KEY]: { kept: true } });
    expect((raw.sessions as { id: string }[]).map((row) => row.id)).toEqual([NOTES, DEMO_YSK_ELSEWHERE, '0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a']);
    // And the host has exactly what the app holds.
    expect(JSON.parse(host.yskText()!)).toEqual(raw);
  });

  it('takes two taps one after the other, each against the version the last one left', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    await checkYouShouldKnow('demo', host, { now: T0 });
    const results = await Promise.all([
      changeHostNotes('demo', host, dismissNote(noteOf(NOTES))),
      changeHostNotes('demo', host, knowNote(noteOf(DEMO_YSK_ELSEWHERE))),
    ]);
    expect(results).toEqual(['changed', 'changed']);
    const rows = JSON.parse(host.yskText()!).sessions as Record<string, unknown>[];
    expect(rows.every((row) => !('view' in row))).toBe(true);
  });

  it('reads again when a read landed during the write, so it never keeps the older file', async () => {
    const { host } = demo();
    host.setUpNotes('w2:p1');
    await checkYouShouldKnow('demo', host, { now: T0 });
    // The swap lands; the terminal writes right after it, and the poll's read
    // sees that before the write's answer is back.
    const racing = {
      exec: async (command: string, timeoutMs: number) => {
        const result = await host.exec(command, timeoutMs);
        if (command.includes(YSK_SWAP_SCRIPT.split('\n')[0]!)) {
          host.touchNotes();
          await checkYouShouldKnow('demo', host, { now: T0 + 10_000 });
        }
        return result;
      },
      streamLines: host.streamLines.bind(host),
    };
    await expect(changeHostNotes('demo', racing, dismissNote(noteOf(NOTES)))).resolves.toBe('changed');
    const held = notesOf('demo');
    await expect(readYouShouldKnow(host, DEMO_YSK_PATH, held.version)).resolves.toEqual({ kind: 'unchanged' });
    expect(JSON.parse(host.yskText()!)).toEqual(held.file!.raw);
  });

  it('says it could not, on a host with no notes', async () => {
    const { host } = demo();
    const note: Note = { sessionId: 'x', tag: 'Heads up', view: { kind: 'offer', line: 'x.', explanation: null, shownAt: 1 } };
    await expect(changeHostNotes('demo', host, dismissNote(note))).resolves.toBe('failed');
  });
});

describe('setNoteChats', () => {
  it('changes nothing when the chats are the ones held', () => {
    const chats = [{ sessionId: 's', workspaceId: 'w1', paneId: 'w1:p1', soleAgent: true, title: 'Notes' }];
    setNoteChats('demo', chats);
    const before = useYouShouldKnow.getState().byConnection;
    setNoteChats('demo', [{ ...chats[0]! }]);
    expect(useYouShouldKnow.getState().byConnection).toBe(before);
    setNoteChats('demo', [{ ...chats[0]!, title: 'Renamed' }]);
    expect(useYouShouldKnow.getState().byConnection).not.toBe(before);
  });
});
