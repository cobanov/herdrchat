import { activePref, mutedSessionIds, type ChatPref } from '../chatPrefs';

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
    const pi = '/home/dev/.pi/agent/sessions/--repo--/2026-09-28T12-00-00_abc.jsonl';
    expect(mutedSessionIds([pref(`pi:path:${encodeURIComponent(pi)}`, { muted: true })])).toEqual([pi]);
  });
});
