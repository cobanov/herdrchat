import type { SQLiteDatabase } from 'expo-sqlite';

import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { DemoHost } from '@/lib/demo/host';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { SLASH_SCAN_TIMEOUT_MS } from '@/lib/herdr/timeouts';
import { catalogueFor, emptyCatalogueCache, serializeCatalogueCache } from '@/lib/slashCommands';
import { slashCommandsKey } from '../db';
import { clearHostSettings } from '../hostTheme';
import {
  loadSlashCatalogues,
  mirrorSlashCatalogues,
  resetSlashCataloguesSession,
  scanSlashCatalogue,
  useSlashCatalogues,
} from '../slashCommands';

jest.mock('@/lib/herdr/sshTransport', () => ({ SshHerdrTransport: class {} }));

/** The settings table, in memory, answering the statements the catalogue uses. */
function fakeDb(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const db = {
    getAllAsync: async (_sql: string, prefix: string) =>
      [...rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    runAsync: async (sql: string, key: string, value?: string) => {
      if (sql.startsWith('INSERT INTO settings')) rows.set(key, value!);
      else if (sql.startsWith('DELETE FROM settings WHERE (length(key) > length(?)')) {
        const machines = `${key}/`;
        for (const stored of [...rows.keys()]) {
          if ((stored.length > key.length && stored.endsWith(key)) || stored.indexOf(machines) > 0) rows.delete(stored);
        }
      } else if (sql.startsWith('DELETE FROM settings WHERE key = ?')) rows.delete(key);
      else throw new Error(`unexpected ${sql}`);
    },
  } as unknown as SQLiteDatabase;
  return { db, rows };
}

const names = (connectionId: string, cwd: string | null = null) =>
  catalogueFor(useSlashCatalogues.getState().byConnection[connectionId] ?? null, 'claude', cwd).map((c) => c.name);

/** A transport that holds every command until `release`, and records what it ran. */
function gated(inner: HerdrTransport) {
  const commands: string[] = [];
  let running = 0;
  let most = 0;
  const waiting: (() => void)[] = [];
  const transport: HerdrTransport = {
    exec: async (command, timeoutMs) => {
      commands.push(command);
      running += 1;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => waiting.push(resolve));
      running -= 1;
      return inner.exec(command, timeoutMs);
    },
    streamLines: inner.streamLines.bind(inner),
  };
  return {
    transport,
    commands,
    most: () => most,
    release: async () => {
      while (waiting.length > 0) {
        waiting.shift()!();
        // Let the scan finish and the next one start.
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      }
    },
  };
}

beforeEach(() => resetSlashCataloguesSession());

describe('scanning a connection', () => {
  it('stores what the Demo host has, host-wide and per folder', async () => {
    const host = new DemoHost();
    await scanSlashCatalogue('h1', host, { host: true, cwds: [] });
    expect(names('h1')).toEqual(expect.arrayContaining(['model', 'effort', 'compact', 'release-notes', 'review', 'demo-tools:lint']));
    expect(names('h1')).not.toContain('notes:summarise');

    await scanSlashCatalogue('h1', host, { host: false, cwds: ['/home/demo/notes'] });
    expect(names('h1', '/home/demo/notes')).toContain('notes:summarise');
    // The host-wide part is kept by a scan that did not read it.
    expect(names('h1')).toContain('review');
  });

  it('runs under the scan timeout, and sends the binary already read', async () => {
    const host = new DemoHost();
    const seen: { command: string; timeout: number | undefined }[] = [];
    const transport: HerdrTransport = {
      exec: (command, timeoutMs) => {
        seen.push({ command, timeout: timeoutMs });
        return host.exec(command, timeoutMs);
      },
      streamLines: host.streamLines.bind(host),
    };
    await scanSlashCatalogue('h1', transport, { host: true, cwds: [] });
    const binary = useSlashCatalogues.getState().byConnection.h1?.binary;
    expect(binary).toEqual(expect.any(String));
    await scanSlashCatalogue('h1', transport, { host: true, cwds: [] });
    expect(seen.map((s) => s.timeout)).toEqual([SLASH_SCAN_TIMEOUT_MS, SLASH_SCAN_TIMEOUT_MS]);
    expect(seen[0]?.command).not.toContain(binary!);
    expect(seen[1]?.command).toContain(binary!);
  });

  // b704ec8: a scan queued in front of everything else. Never two at once.
  it('never runs two scans at once for one connection, and merges what waits', async () => {
    const gate = gated(new DemoHost());
    const first = scanSlashCatalogue('h1', gate.transport, { host: true, cwds: [] });
    const second = scanSlashCatalogue('h1', gate.transport, { host: false, cwds: ['/home/demo/notes'] });
    const third = scanSlashCatalogue('h1', gate.transport, { host: false, cwds: ['/home/demo/other'] });
    expect(gate.commands).toHaveLength(1);
    await gate.release();
    await Promise.all([first, second, third]);
    expect(gate.most()).toBe(1);
    // The two waiting asks went as one scan.
    expect(gate.commands).toHaveLength(2);
    expect(gate.commands[1]).toContain('/home/demo/notes');
    expect(gate.commands[1]).toContain('/home/demo/other');
    expect(names('h1', '/home/demo/notes')).toContain('notes:summarise');
  });

  it('keeps the catalogue it has when a scan fails, and never rejects', async () => {
    const host = new DemoHost();
    await scanSlashCatalogue('h1', host, { host: true, cwds: [] });
    const held = useSlashCatalogues.getState().byConnection.h1;
    const down: HerdrTransport = {
      exec: async (): Promise<ExecResult> => ({ ok: false, code: 'connect_failed', message: 'down' }),
      streamLines: host.streamLines.bind(host),
    };
    await expect(scanSlashCatalogue('h1', down, { host: true, cwds: [] })).resolves.toBeUndefined();
    const throws: HerdrTransport = {
      exec: async () => {
        throw new Error('channel closed');
      },
      streamLines: host.streamLines.bind(host),
    };
    await expect(scanSlashCatalogue('h1', throws, { host: true, cwds: [] })).resolves.toBeUndefined();
    expect(useSlashCatalogues.getState().byConnection.h1).toBe(held);
  });

  it('drops the answer of a scan in flight for a host that was removed, its machines\' too', async () => {
    const gate = gated(new DemoHost());
    const { db } = fakeDb();
    const scan = scanSlashCatalogue('h1/m-klaw', gate.transport, { host: true, cwds: [] });
    await clearHostSettings(db, 'h1');
    await gate.release();
    await scan;
    expect(useSlashCatalogues.getState().byConnection['h1/m-klaw']).toBeUndefined();
  });
});

describe('persistence', () => {
  it('writes each scan to its own row, a machine\'s beside its host\'s', async () => {
    const { db, rows } = fakeDb();
    const stop = mirrorSlashCatalogues(db);
    await scanSlashCatalogue('h1', new DemoHost(), { host: true, cwds: [] });
    await scanSlashCatalogue('h1/m-klaw', new DemoHost(), { host: true, cwds: [] });
    await Promise.resolve();
    expect(rows.get(slashCommandsKey('h1'))).toContain('release-notes');
    expect(rows.get(slashCommandsKey('h1/m-klaw'))).toContain('release-notes');
    stop();
  });

  it('is complete at launch from the table, before any scan, and skips a row it cannot read', async () => {
    const cache = { ...emptyCatalogueCache(), user: [{ name: 'mine', description: 'Mine', argumentHint: null, section: 'commands' as const, source: 'user' as const }] };
    const { db, rows } = fakeDb({
      [slashCommandsKey('h1')]: serializeCatalogueCache(cache),
      [slashCommandsKey('h2')]: '{"version":99}',
    });
    const stop = mirrorSlashCatalogues(db);
    await loadSlashCatalogues(db);
    expect(names('h1')).toContain('mine');
    expect(useSlashCatalogues.getState().byConnection.h2).toBeUndefined();
    // Not written back: those rows came from the table.
    expect(rows.get(slashCommandsKey('h2'))).toBe('{"version":99}');
    stop();
  });

  it('keeps a scan that landed before the launch read the table', async () => {
    const { db } = fakeDb({ [slashCommandsKey('h1')]: serializeCatalogueCache(emptyCatalogueCache()) });
    await scanSlashCatalogue('h1', new DemoHost(), { host: true, cwds: [] });
    await loadSlashCatalogues(db);
    expect(names('h1')).toContain('release-notes');
  });

  it('goes with its host, rows and memory, its machines\' with it', async () => {
    const { db, rows } = fakeDb();
    const stop = mirrorSlashCatalogues(db);
    await scanSlashCatalogue('h1', new DemoHost(), { host: true, cwds: [] });
    await scanSlashCatalogue('h1/m-klaw', new DemoHost(), { host: true, cwds: [] });
    await scanSlashCatalogue('h2', new DemoHost(), { host: true, cwds: [] });
    await Promise.resolve();
    await clearHostSettings(db, 'h1');
    await Promise.resolve();
    expect(Object.keys(useSlashCatalogues.getState().byConnection)).toEqual(['h2']);
    expect([...rows.keys()].filter((key) => key.startsWith('slashCommands.'))).toEqual([slashCommandsKey('h2')]);
    stop();
  });
});
