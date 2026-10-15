import { activePref, mutedSessionIds, prefSource, type ChatPref } from '../chatPrefs';

const pref = (sessionSig: string, extra: Partial<ChatPref> = {}): ChatPref => ({ sessionSig, pinnedAt: null, muted: false, ...extra });

describe('chat prefs', () => {
  // herdr reuses workspace ids: a new chat in a pinned slot is not pinned.
  it('applies only to the conversation it was made for', () => {
    const prefs = new Map([['w1', pref('s-old', { pinnedAt: 1 })]]);
    expect(activePref(prefs, 'w1', 's-old')?.pinnedAt).toBe(1);
    expect(activePref(prefs, 'w1', 's-new')).toBeNull();
    expect(activePref(prefs, 'w1', null)).toBeNull();
    expect(activePref(prefs, 'w2', 's-old')).toBeNull();
  });

  it('hands the watcher raw session ids, Codex marks removed', () => {
    expect(mutedSessionIds([
      pref('b,a', { muted: true }),
      pref('codex:c', { muted: true }),
      pref('d', { pinnedAt: 5 }),
      pref('a', { muted: true }),
    ])).toEqual(['a', 'b', 'c']);
  });

  // OMP reports a path, signed as omp:<kind>:<encoded value>; the watcher sees the path.
  it('hands the watcher an OMP session as the path herdr reported', () => {
    const path = '/home/dev/.omp/agent/sessions/--repo--/2026-09-28T12-00-00_abc.jsonl';
    expect(mutedSessionIds([pref(`omp:path:${encodeURIComponent(path)},claude-id`, { muted: true })])).toEqual([path, 'claude-id']);
    expect(mutedSessionIds([pref('omp:id:abc-123', { muted: true })])).toEqual(['abc-123']);
  });
});

describe('prefSource', () => {
  const own = { key: 'w6/w6:p2', sessionSig: 'S_B' };
  const alone = { key: 'w6', sessionSig: 'S_B' };
  const card = { key: 'w6', sessionSig: 'S_A,S_B' };
  const refs = [own, alone, card];

  it('takes the row\'s own pref first', () => {
    const prefs = new Map<string, ChatPref>([
      ['w6/w6:p2', { sessionSig: 'S_B', pinnedAt: 1, muted: false }],
      ['w6', { sessionSig: 'S_A,S_B', pinnedAt: 2, muted: true }],
    ]);
    expect(prefSource(prefs, refs, 'pin')).toBe(own);
    // Its own pref does not mute it; the card's does.
    expect(prefSource(prefs, refs, 'mute')).toBe(card);
  });

  // Pinned while it was w6's only agent, then a second agent started.
  it('keeps the pin an agent got while it was alone in its workspace', () => {
    const prefs = new Map<string, ChatPref>([['w6', { sessionSig: 'S_B', pinnedAt: 3, muted: true }]]);
    expect(prefSource(prefs, refs, 'pin')).toBe(alone);
    expect(prefSource(prefs, refs, 'mute')).toBe(alone);
  });

  it('holds nothing from another session, or from a pref that chose neither', () => {
    const prefs = new Map<string, ChatPref>([
      ['w6/w6:p2', { sessionSig: 'S_old', pinnedAt: 1, muted: true }],
      ['w6', { sessionSig: 'S_A,S_B', pinnedAt: null, muted: false }],
    ]);
    expect(prefSource(prefs, refs, 'pin')).toBeNull();
    expect(prefSource(prefs, refs, 'mute')).toBeNull();
    expect(prefSource(prefs, [{ key: 'w6/w6:p2', sessionSig: null }], 'pin')).toBeNull();
  });
});
