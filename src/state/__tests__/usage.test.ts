import type { SQLiteDatabase } from 'expo-sqlite';

import type { ExecResult } from '../../../modules/herdr-ssh/src';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { USAGE_BEGIN, USAGE_MISSING } from '@/lib/usage/usageClient';
import { originalFileText, WRAPPER_COMMAND } from '@/lib/usage/statusLineWrap';
import { usageConsentKey } from '../db';
import { clearHostSettings } from '../hostTheme';
import {
  checkPlanUsage,
  loadUsageConsent,
  resetPlanUsageSession,
  turnOffUsage,
  turnOnUsage,
  usageOn,
  usePlanUsage,
} from '../usage';

jest.mock('@/state/sshTransport', () => ({ SshHerdrTransport: class {} }));

/** The settings table, in memory, answering the statements consent uses. */
function fakeDb(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const db = {
    getAllAsync: async (_sql: string, prefix: string) =>
      [...rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    runAsync: async (sql: string, key: string, value?: string) => {
      if (sql.startsWith('INSERT INTO settings')) rows.set(key, value!);
      else if (sql.startsWith('DELETE FROM settings WHERE key = ?')) rows.delete(key);
      else if (sql.startsWith('DELETE FROM settings WHERE (length(key) > length(?)')) {
        for (const stored of [...rows.keys()]) if (stored.length > key.length && stored.endsWith(key)) rows.delete(stored);
      } else throw new Error(`unexpected ${sql}`);
    },
  } as unknown as SQLiteDatabase;
  return { db, rows };
}

const FAR = 4102444800;
const ok = (stdout: string): ExecResult => ({ ok: true, exitCode: 0, stdout, stderr: '' });
const usageFile = (sevenDayUsed: number) =>
  `${USAGE_BEGIN}\n${JSON.stringify({ captured_at: 100, status: { rate_limits: { seven_day: { used_percentage: sevenDayUsed, resets_at: FAR } } } })}`;

/** A host whose answers a test sets, with every command it was sent. */
function host() {
  const commands: string[] = [];
  let usage = usageFile(38);
  let down = false;
  const waiting: (() => void)[] = [];
  let hold = false;
  const settings = `{"statusLine":{"type":"command","command":"echo mine"}}`;
  const transport: HerdrTransport = {
    exec: async (command) => {
      commands.push(command);
      if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
      if (down) return { ok: false, code: 'connect_failed', message: 'The host is down.' };
      if (command.includes(USAGE_BEGIN)) return ok(usage);
      if (command.includes('hc_file')) {
        const wrapped = commands.some((sent) => sent.includes('@@herdrchat:done'));
        const text = wrapped ? `{"statusLine":{"type":"command","command":"${WRAPPER_COMMAND}"}}` : settings;
        const saved = originalFileText({ statusLine: { type: 'command', command: 'echo mine' }, createdSettings: false });
        const original = wrapped ? `@@herdrchat:original begin 1 ${saved.length}\n${saved}\n@@herdrchat:original end\n` : '@@herdrchat:original none\n';
        return ok(`@@herdrchat:settings begin 1 ${text.length}\n${text}\n@@herdrchat:settings end\n${original}@@herdrchat:wrapper none\n`);
      }
      return ok('@@herdrchat:done\n');
    },
    streamLines: async function* () {
      yield* [];
    },
  };
  return {
    transport,
    commands,
    setUsage: (text: string) => { usage = text; },
    setDown: (value: boolean) => { down = value; },
    hold: () => { hold = true; },
    release: () => { hold = false; for (const resolve of waiting.splice(0)) resolve(); },
  };
}

beforeEach(() => resetPlanUsageSession());

it('reads a host once for two callers at a time', async () => {
  const h = host();
  const [a, b] = await Promise.all([checkPlanUsage('h1', h.transport), checkPlanUsage('h1', h.transport)]);
  expect([a, b]).toEqual([true, true]);
  expect(h.commands).toHaveLength(1);
  expect(usePlanUsage.getState().byConnection.h1?.sevenDay?.percentLeft).toBe(62);
});

it('keeps what it showed when a read fails, and shows nothing once the file is gone', async () => {
  const h = host();
  await checkPlanUsage('h1', h.transport);
  h.setDown(true);
  expect(await checkPlanUsage('h1', h.transport)).toBe(false);
  expect(usePlanUsage.getState().byConnection.h1?.sevenDay?.percentLeft).toBe(62);
  h.setDown(false);
  h.setUsage(`${USAGE_MISSING}\n`);
  await checkPlanUsage('h1', h.transport);
  expect(usePlanUsage.getState().byConnection.h1).toBeNull();
});

// Turned off (or the host removed) while a read was on its way back.
it('drops the answer of a read started before the host was cleared', async () => {
  const h = host();
  h.hold();
  const check = checkPlanUsage('h1', h.transport);
  usePlanUsage.getState().clear('h1');
  h.release();
  await check;
  expect(usePlanUsage.getState().byConnection).toEqual({});
});

it('turns on: installs, remembers the agreement, and reads at once', async () => {
  const { db, rows } = fakeDb();
  const h = host();
  expect(usageOn('h1')).toBe(false);
  expect(await turnOnUsage(db, 'h1', h.transport)).toEqual({ ok: true });
  expect(rows.get(usageConsentKey('h1'))).toBe('1');
  expect(usageOn('h1')).toBe(true);
  expect(usePlanUsage.getState().byConnection.h1?.sevenDay?.percentLeft).toBe(62);
});

it('remembers nothing when the install fails', async () => {
  const { db, rows } = fakeDb();
  const h = host();
  h.setDown(true);
  expect(await turnOnUsage(db, 'h1', h.transport)).toEqual({ ok: false, code: 'connect_failed', message: 'The host is down.' });
  expect(rows.size).toBe(0);
  expect(usageOn('h1')).toBe(false);
});

it('turns off: forgets the agreement and the usage, and keeps both when the host cannot be reached', async () => {
  const { db, rows } = fakeDb();
  const h = host();
  await turnOnUsage(db, 'h1', h.transport);
  h.setDown(true);
  expect(await turnOffUsage(db, 'h1', h.transport)).toEqual(expect.objectContaining({ ok: false }));
  expect(usageOn('h1')).toBe(true);
  h.setDown(false);
  expect(await turnOffUsage(db, 'h1', h.transport)).toEqual({ ok: true });
  expect(rows.has(usageConsentKey('h1'))).toBe(false);
  expect(usageOn('h1')).toBe(false);
  expect(usePlanUsage.getState().byConnection.h1).toBeUndefined();
});

it('loads the agreements at launch, and the Demo needs none', async () => {
  const { db } = fakeDb({ [usageConsentKey('h1')]: '1', [usageConsentKey('h2')]: '0', other: '1' });
  await loadUsageConsent(db);
  expect(usageOn('h1')).toBe(true);
  expect(usageOn('h2')).toBe(false);
  expect(usageOn('demo')).toBe(true);
});

// A host re-added under the same id asks again before installing anything.
it('forgets a removed host’s agreement and usage', async () => {
  const { db, rows } = fakeDb();
  const h = host();
  await turnOnUsage(db, 'h1', h.transport);
  await clearHostSettings(db, 'h1');
  expect(rows.size).toBe(0);
  expect(usageOn('h1')).toBe(false);
  expect(usePlanUsage.getState().byConnection.h1).toBeUndefined();
});
