import type { SQLiteDatabase } from 'expo-sqlite';

import { getPushDeviceId, newDeviceId } from '../deviceId';
import { deviceFileId, errorDetail, matchingTokenFiles, parseTokenDirListing } from '../push';

/**
 * `deviceFileId` builds a filename that is interpolated into a shell path on the
 * host. Anything that survives the filter and is not inert there is a command
 * injection on the user's own machine, so the filter is pinned rather than
 * trusted.
 */
describe('deviceFileId', () => {
  it('keeps characters that are already inert', () => {
    expect(deviceFileId('A1b2-c3D4')).toBe('A1b2-c3D4');
  });

  it('replaces every shell metacharacter', () => {
    expect(deviceFileId('a;rm -rf /')).toBe('a-rm--rf--');
    expect(deviceFileId('$(whoami)')).toBe('--whoami-');
    expect(deviceFileId('`id`')).toBe('-id-');
    expect(deviceFileId("a'b\"c")).toBe('a-b-c');
  });

  it('refuses to emit a path that escapes the token directory', () => {
    // Dots are not in the allow-list, so traversal collapses to dashes rather
    // than reaching a parent directory.
    expect(deviceFileId('../../etc/passwd')).toBe('------etc-passwd');
    expect(deviceFileId('..')).toBe('--');
  });

  it('never returns an empty name', () => {
    // An empty id would write to "<dir>/.json" — a shared file every install
    // would clobber, rather than one file per device.
    expect(deviceFileId('')).toBe('device');
    expect(deviceFileId('!!!')).toBe('---');
  });
});

/**
 * The detail line under a failed registration. It exists because a TestFlight
 * build has no console: if the real error is not on screen it is unreachable.
 */
describe('errorDetail', () => {
  it('takes the message from an Error', () => {
    expect(errorDetail(new Error('no valid aps-environment entitlement'))).toBe(
      'no valid aps-environment entitlement'
    );
  });

  it('stringifies a non-Error', () => {
    expect(errorDetail('plain string failure')).toBe('plain string failure');
    expect(errorDetail(42)).toBe('42');
  });

  it('is undefined when there is nothing to show', () => {
    // An empty detail would render as a blank line under the note, which reads
    // as a layout bug rather than as an absence.
    expect(errorDetail(new Error(''))).toBeUndefined();
    expect(errorDetail('   ')).toBeUndefined();
    expect(errorDetail(undefined)).toBeUndefined();
  });
});

/**
 * A settings table that is just a map: getPushDeviceId only touches
 * getSetting/setSetting, which are one SELECT and one UPSERT by key.
 */
function fakeSettingsDb() {
  const rows = new Map<string, string>();
  const db = {
    getFirstAsync: async (_sql: string, key: string) =>
      rows.has(key) ? { value: rows.get(key) } : null,
    runAsync: async (_sql: string, key: string, value: string) => {
      rows.set(key, value);
    },
  } as unknown as SQLiteDatabase;
  return { db, rows };
}

/**
 * The id names the token file on every host. It used to come from
 * `Constants.sessionId`, which changes each launch — files accumulated, the
 * watcher pushed to all of them, and opt-out missed the older ones. Stability
 * across calls (and so across launches) is the whole fix.
 */
describe('getPushDeviceId', () => {
  it('returns the same id on every call', async () => {
    const { db } = fakeSettingsDb();
    const first = await getPushDeviceId(db);
    const second = await getPushDeviceId(db);
    expect(second).toBe(first);
  });

  it('round-trips through the settings table', async () => {
    const { db, rows } = fakeSettingsDb();
    const id = await getPushDeviceId(db);
    expect(rows.get('pushDeviceId')).toBe(id);
    // A pre-existing row wins over generating anew — that is what makes the id
    // per-install rather than per-launch.
    rows.set('pushDeviceId', 'cafe1234cafe1234');
    expect(await getPushDeviceId(db)).toBe('cafe1234cafe1234');
  });

  it('generates ids that survive deviceFileId unchanged', () => {
    const id = newDeviceId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(deviceFileId(id)).toBe(id);
  });
});

/**
 * Opt-out cleanup. The directory holds every device's tokens, so deletion is
 * by exact match on the parsed "token" field — never by filename age or
 * substring — and anything unparseable is left alone.
 */
describe('matchingTokenFiles', () => {
  const mine = 'aabbcc';
  const files = [
    { name: 'legacy-session-1.json', content: JSON.stringify({ token: mine, env: 'production' }) },
    { name: 'legacy-session-2.json', content: JSON.stringify({ token: mine }) },
    { name: 'other-device.json', content: JSON.stringify({ token: 'ddeeff' }) },
    { name: 'corrupt.json', content: '{not json' },
    // A token that merely CONTAINS ours must not match.
    { name: 'superstring.json', content: JSON.stringify({ token: `${mine}00` }) },
    { name: 'no-token-field.json', content: JSON.stringify({ env: 'production' }) },
  ];

  it('selects exactly the files whose token field matches', () => {
    expect(matchingTokenFiles(files, mine)).toEqual([
      'legacy-session-1.json',
      'legacy-session-2.json',
    ]);
  });

  it('selects nothing when nothing matches', () => {
    expect(matchingTokenFiles(files, 'zz9900')).toEqual([]);
    expect(matchingTokenFiles([], mine)).toEqual([]);
  });
});

describe('parseTokenDirListing', () => {
  it('splits name<TAB>content lines and drops framing noise', () => {
    const stdout = 'a.json\t{"token":"t1"}\nb.json\t{"token":"t2"}\n\ntrailing-no-tab\n';
    expect(parseTokenDirListing(stdout)).toEqual([
      { name: 'a.json', content: '{"token":"t1"}' },
      { name: 'b.json', content: '{"token":"t2"}' },
    ]);
  });

  it('returns nothing for an empty directory', () => {
    expect(parseTokenDirListing('')).toEqual([]);
  });
});
