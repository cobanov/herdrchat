import type { AgentInfo, Workspace } from '../herdr/models';
import { DEMO_YSK_ELSEWHERE, DEMO_YSK_EXPLANATION, DEMO_YSK_LINE, DEMO_YSK_UNKNOWN_KEY, demoYskStore } from '../demo/scenarios';
import {
  KNOWN_MAX,
  appendKnown,
  askedAt,
  byNewest,
  chatFor,
  chatNoteSession,
  dismissNote,
  knowNote,
  learnMore,
  noteChats,
  noteExplanation,
  noteHead,
  noteOf,
  noteTag,
  notesBarLine,
  notesBarText,
  notesForYou,
  parseView,
  parseYskFile,
  serializeYsk,
  type Note,
} from '../youShouldKnow/notes';

const CHAT = '22222222-2222-4222-8222-222222222222';
const T = Date.parse('2026-10-24T12:00:00Z');
const store = () => demoYskStore(CHAT, T);
const file = () => parseYskFile(serializeYsk(store()))!;
const offer = (): Note => file().notes[0]!;
const explained = (): Note => file().notes[1]!;
const rows = (raw: Record<string, unknown> | null) => (raw?.sessions ?? []) as Record<string, unknown>[];

describe('noteTag', () => {
  it('reads Heads up however it is written, and anything else as You should know', () => {
    for (const tag of ['Heads up', 'heads-up', 'HEADS UP!', ' **Heads  up** ']) expect(noteTag(tag)).toBe('Heads up');
    for (const tag of ['You should know', 'Heads up, really', 'FYI', '', undefined, 3]) expect(noteTag(tag)).toBe('You should know');
  });
});

describe('parseYskFile', () => {
  it('reads the notes a good file shows, keeping every key and row', () => {
    const parsed = file();
    expect(parsed.notes).toEqual([
      { sessionId: CHAT, tag: 'Heads up', view: { kind: 'offer', line: DEMO_YSK_LINE, explanation: DEMO_YSK_EXPLANATION, shownAt: T - 120_000 } },
      expect.objectContaining({ sessionId: DEMO_YSK_ELSEWHERE, tag: 'You should know', view: expect.objectContaining({ kind: 'explained' }) }),
    ]);
    expect(rows(parsed.raw)).toHaveLength(3);
    expect(parsed.raw[DEMO_YSK_UNKNOWN_KEY]).toEqual({ kept: true });
  });

  it('reads a sessions that is not a list as no notes', () => {
    expect(parseYskFile('{"sessions":{"id":"a"},"known":[]}')).toEqual({ raw: { sessions: { id: 'a' }, known: [] }, notes: [] });
    expect(parseYskFile('{}')?.notes).toEqual([]);
  });

  it('is null for what is not a JSON object, a write caught halfway', () => {
    for (const text of ['', '{"sessions":[', '[]', 'null', '"x"']) expect(parseYskFile(text)).toBeNull();
  });

  it('skips rows without an id, and views it does not show, but keeps them for writing', () => {
    const view = { kind: 'offer', line: 'A line.', shownAt: 1 };
    const raw = {
      sessions: [
        { view },
        { id: 7, view },
        { id: '', view },
        { id: 'a', view: { kind: 'explaining', line: 'A line.', iteration: 1 } },
        { id: 'b', view: { kind: 'asked', line: 'A line.', shownAt: 1 } },
        { id: 'c', view: { kind: 'making', line: 'A line.' } },
        { id: 'd', view: { kind: 'failed', reason: 'no' } },
        { id: 'e', view: { kind: 'off', line: 'A line.', shownAt: 1 } },
        { id: 'f', view: { kind: 'someday', line: 'A line.', shownAt: 1 } },
        { id: 'g' },
        'nonsense',
        { id: 'h', view },
      ],
    };
    const parsed = parseYskFile(JSON.stringify(raw))!;
    expect(parsed.notes.map((note) => note.sessionId)).toEqual(['h']);
    expect(rows(parsed.raw)).toEqual(raw.sessions);
  });

  it('needs a line and a time on a view, a text on an explained one, and a web address on a learning page', () => {
    expect(parseView({ kind: 'offer', line: '', shownAt: 1 })).toBeNull();
    expect(parseView({ kind: 'offer', line: 'x', shownAt: Number.NaN })).toBeNull();
    expect(parseView({ kind: 'offer', line: 'x', shownAt: 1, explanation: '  ' })).toEqual({ kind: 'offer', line: 'x', explanation: null, shownAt: 1 });
    expect(parseView({ kind: 'explained', line: 'x', shownAt: 1 })).toBeNull();
    expect(parseView({ kind: 'ready', line: 'x', shownAt: 1, url: 'javascript:alert(1)' })).toBeNull();
    expect(parseView({ kind: 'ready', line: 'x', shownAt: 1, url: 'https://claude.ai/artifact/abc' })).toEqual({
      kind: 'ready', line: 'x', url: 'https://claude.ai/artifact/abc', shownAt: 1,
    });
  });
});

describe('showing notes', () => {
  it('orders newest first', () => {
    const notes = file().notes.slice().reverse().sort(byNewest);
    expect(notes.map((note) => note.sessionId)).toEqual([CHAT, DEMO_YSK_ELSEWHERE]);
  });

  it('heads a note as the terminal does, and says how many there are', () => {
    expect(noteHead(offer())).toBe(`✦ Heads up · ${DEMO_YSK_LINE}`);
    expect(notesForYou(1)).toBe('1 note for you');
    expect(notesForYou(2)).toBe('2 notes for you');
    expect(notesBarText([])).toBeNull();
    expect(notesBarLine(notesBarText([offer()])!)).toBe(`✦ Heads up · ${DEMO_YSK_LINE}`);
    expect(notesBarLine(notesBarText(file().notes)!)).toBe('✦ 2 notes for you');
  });

  it('finds the explanation an offer carries, or the one showing', () => {
    expect(noteExplanation(offer())).toBe(DEMO_YSK_EXPLANATION);
    expect(noteExplanation(explained())).toMatch(/^\*\*Rounding per line adds up\*\*/);
    expect(noteExplanation({ view: { kind: 'ready', line: 'x', url: 'https://x.dev', shownAt: 1 } })).toBeNull();
  });

  it('says when, in local time', () => {
    const now = new Date(2026, 9, 24, 15, 0).getTime();
    expect(askedAt(new Date(2026, 9, 24, 9, 5).getTime(), now)).toBe('Today, 9:05 AM');
    expect(askedAt(new Date(2026, 9, 23, 12, 30).getTime(), now)).toBe('Yesterday, 12:30 PM');
    expect(askedAt(new Date(2026, 9, 4, 0, 1).getTime(), now)).toBe('Oct 4, 12:01 AM');
    expect(askedAt(new Date(2025, 0, 2, 23, 59).getTime(), now)).toBe('Jan 2, 2025, 11:59 PM');
  });
});

function agent(paneId: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    agent: 'claude', agentStatus: 'idle', cwd: '/x', foregroundCwd: null, focused: false, paneId, tabId: 't', terminalId: null,
    workspaceId: 'w1', agentSession: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: `s-${paneId}` },
    stateChangeSeq: null, completionSeq: null, title: null, name: null, ...overrides,
  } as AgentInfo;
}
const session = (value: string) => ({ agent: 'claude', kind: 'id', source: 'herdr:claude', value }) as AgentInfo['agentSession'];

describe('chats', () => {
  const workspaces = [{ workspaceId: 'w1', label: 'notes' }, { workspaceId: 'w2', label: 'api' }] as Workspace[];

  it('are the Claude agents with a session, titled as their rows are', () => {
    const chats = noteChats(
      [
        agent('w1:p1', { title: 'Release notes summary' }),
        agent('w2:p1', { workspaceId: 'w2' }),
        agent('w2:p2', { workspaceId: 'w2', agent: 'codex' }),
        agent('w1:p9', { workspaceId: 'w9', agentSession: null }),
      ],
      workspaces
    );
    expect(chats).toEqual([
      { sessionId: 's-w1:p1', workspaceId: 'w1', paneId: 'w1:p1', soleAgent: true, title: 'Release notes summary' },
      { sessionId: 's-w2:p1', workspaceId: 'w2', paneId: 'w2:p1', soleAgent: false, title: 'api' },
    ]);
    expect(noteChats([agent('w3:p1', { workspaceId: 'w3' })], null)[0]?.title).toBe('w3');
  });

  it('match a note by its session id, exactly', () => {
    const chats = [{ sessionId: CHAT }, { sessionId: 'other' }];
    expect(chatFor(offer(), chats)).toBe(chats[0]);
    expect(chatFor({ sessionId: CHAT.slice(0, 8) }, chats)).toBeNull();
    expect(noteOf(file().notes, CHAT)).toEqual(offer());
    expect(noteOf(file().notes, '')).toBeNull();
  });

  it('show in a chat only the note of the session its composer sends to', () => {
    const one = agent('w1:p1', { agentSession: session(CHAT) });
    const focused = agent('w1:p2', { agentSession: session('other'), focused: true });
    expect(chatNoteSession([one, focused])).toBe('other');
    expect(chatNoteSession([one])).toBe(CHAT);
    expect(chatNoteSession([agent('w1:p1', { agent: 'codex', agentSession: session(CHAT) })])).toBe('');
    expect(chatNoteSession([agent('w1:p1', { agentSession: null })])).toBe('');
    expect(chatNoteSession([])).toBe('');
  });
});

describe('changes', () => {
  it('Learn more shows the offer’s explanation, and changes no other row', () => {
    const raw = store();
    const next = learnMore(offer(), 999)!(raw)!;
    expect(rows(next)[0]).toEqual({
      id: CHAT, tag: 'Heads up', askedTurn: 6, offeredTurn: 6,
      view: { kind: 'explained', line: DEMO_YSK_LINE, text: DEMO_YSK_EXPLANATION, iteration: 1, shownAt: 999 },
    });
    expect(rows(next).slice(1)).toEqual(rows(raw).slice(1));
    expect({ ...next, sessions: null }).toEqual({ ...raw, sessions: null });
    // Not for an offer without its explanation, nor for one already explained.
    expect(learnMore({ ...offer(), view: { kind: 'offer', line: 'x', explanation: null, shownAt: 1 } }, 1)).toBeNull();
    expect(learnMore(explained(), 1)).toBeNull();
  });

  it('Knew this already adds the line to known, takes the note away and resets the counters', () => {
    const raw = store();
    const next = knowNote(offer())(raw)!;
    expect(rows(next)[0]).toEqual({ id: CHAT, tag: 'Heads up', askedTurn: 6, offeredTurn: 6 });
    expect(rows(next).slice(1)).toEqual(rows(raw).slice(1));
    expect(next).toMatchObject({ known: [DEMO_YSK_LINE], typedPastInARow: 0, looksToSkip: 0, seen: raw.seen });
    expect(next[DEMO_YSK_UNKNOWN_KEY]).toEqual({ kept: true });
    // The input is left as it was.
    expect(rows(raw)[0]).toHaveProperty('view');
  });

  it('keeps known free of a line in another case, and at most fifty long', () => {
    expect(appendKnown(['a', 'THE LINE.', 'b'], 'The line.')).toEqual(['a', 'b', 'The line.']);
    expect(appendKnown('nonsense', 'x')).toEqual(['x']);
    expect(appendKnown([1, 'a'], 'x')).toEqual(['a', 'x']);
    const full = Array.from({ length: KNOWN_MAX }, (_, index) => `line ${index}`);
    const next = appendKnown(full, 'new');
    expect(next).toHaveLength(KNOWN_MAX);
    expect(next[0]).toBe('line 1');
    expect(next.at(-1)).toBe('new');
  });

  it('Dismiss takes the note away and learns nothing', () => {
    const raw = store();
    const next = dismissNote(explained())(raw)!;
    expect(rows(next)[1]).toEqual({ id: DEMO_YSK_ELSEWHERE, tag: 'You should know', checks: 3 });
    expect(next).toMatchObject({ known: [], typedPastInARow: 0, looksToSkip: 0 });
  });

  it('resets only counters above zero, and adds none', () => {
    const raw: Record<string, unknown> = { ...store(), looksToSkip: 0 };
    delete raw.typedPastInARow;
    const next = dismissNote(offer())(raw)!;
    expect(next).not.toHaveProperty('typedPastInARow');
    expect(next.looksToSkip).toBe(0);
  });

  it('does nothing once the terminal has moved the note on, or it is gone', () => {
    const note = offer();
    const raw = store();
    const shownAgain = { ...raw, sessions: rows(raw).map((row, index) => (index === 0 ? { ...row, view: { ...(row.view as object), shownAt: 1 } } : row)) };
    expect(knowNote(note)(shownAgain)).toBeNull();
    const explainedNow = learnMore(note, 5)!(raw)!;
    expect(dismissNote(note)(explainedNow)).toBeNull();
    expect(dismissNote(note)({ ...raw, sessions: rows(raw).slice(1) })).toBeNull();
    expect(dismissNote(note)({ sessions: 'x' })).toBeNull();
  });
});
