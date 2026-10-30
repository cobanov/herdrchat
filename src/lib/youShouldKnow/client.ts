/**
 * "You should know"'s round-trips, over any transport: detect, read, and change.
 *
 * None of them throws. Detecting and reading are side tasks of the chat
 * list's poll, so a failure is worth one bit (null: keep what you have, try
 * again later); a change is something the person did and is waiting on, so
 * it says whether it happened.
 */
import { POLL_TIMEOUT_MS, SEND_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import {
  YSK_MAX_BYTES,
  yskCleanupCommand,
  yskDetectCommand,
  yskReadCommand,
  yskWriteCommands,
  parseYskDetect,
  parseYskRead,
  parseYskWrite,
  utf8Bytes,
  type YskDetect,
  type YskRead,
  type YskWrite,
} from './command';
import { parseYskFile, serializeYsk, type YskChange, type YskFile } from './notes';

/**
 * How often the chat list's poll looks for the store, once it has looked:
 * the slash commands' cadence. A host gets the plugin when someone turns it
 * on, which is rare; ten minutes notices that the same session, and a pull to
 * refresh sooner.
 */
export const YSK_DETECT_INTERVAL_MS = 600_000;

/**
 * How often the poll reads the list while the chats are on screen: the host
 * theme's cadence. Sessions write it as notes come and go; ten seconds keeps
 * the bar current for a line of traffic when nothing moved.
 */
export const YSK_READ_INTERVAL_MS = 10_000;

export function yskDetectDue(lastDetect: number | null, now: number): boolean {
  return lastDetect === null || now - lastDetect >= YSK_DETECT_INTERVAL_MS;
}

export function yskReadDue(lastRead: number | null, now: number): boolean {
  return lastRead === null || now - lastRead >= YSK_READ_INTERVAL_MS;
}

/** A command, or null when its builder refused what it was given (a bad path, version or token). */
function built<T>(build: () => T): T | null {
  try {
    return build();
  } catch {
    return null;
  }
}

async function run(transport: HerdrTransport, command: string | null, timeoutMs: number): Promise<string | null> {
  if (command === null) return null;
  try {
    const result = await transport.exec(command, timeoutMs);
    return result.ok && result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

/** Where the store is, that there is none, or null for a failed check. */
export async function detectYouShouldKnow(transport: HerdrTransport): Promise<YskDetect | null> {
  const stdout = await run(transport, yskDetectCommand(), POLL_TIMEOUT_MS);
  return stdout === null ? null : parseYskDetect(stdout);
}

/** The store, read against the version held. Null for a failed read. */
export async function readYouShouldKnow(transport: HerdrTransport, path: string, lastVersion: string | null): Promise<YskRead | null> {
  const stdout = await run(transport, built(() => yskReadCommand(path, lastVersion)), POLL_TIMEOUT_MS);
  return stdout === null ? null : parseYskRead(stdout, lastVersion);
}

/** Write `raw` over the store if it still has `version`. Null for a failed write. */
export async function writeYouShouldKnow(
  transport: HerdrTransport,
  path: string,
  version: string,
  raw: Record<string, unknown>,
  token: string
): Promise<YskWrite | null> {
  const json = serializeYsk(raw);
  if (utf8Bytes(json) > YSK_MAX_BYTES) return null;
  const commands = built(() => yskWriteCommands(path, version, json, token));
  if (commands === null) return null;
  let stdout: string | null = null;
  for (const command of commands) {
    stdout = await run(transport, command, SEND_TIMEOUT_MS);
    if (stdout === null) {
      // A command that did not go may leave the part file beside the store
      // (the plugin's glob never matches it): a piece always, the swap when
      // the connection dropped under it. Removed on a best effort, not
      // awaited: the host may be the reason the command failed.
      void run(transport, built(() => yskCleanupCommand(path, token)), POLL_TIMEOUT_MS);
      return null;
    }
  }
  return stdout === null ? null : parseYskWrite(stdout);
}

/** The store as the app holds it: where, which version, and what it said. */
export interface HeldStore {
  path: string;
  version: string;
  file: YskFile;
}

export type ChangeResult =
  /**
   * Written (`changed`), or nothing to write: the change found the note
   * gone, or moved on by the terminal. `held` is the store as it now is.
   */
  | { ok: true; changed: boolean; held: HeldStore }
  /** Not written: the host could not be reached, or the file kept changing under it. */
  | { ok: false; held: HeldStore | null };

/** How many tokens a write's temp file can have: ten base-36 characters. */
export const YSK_TOKEN_SPACE = 36 ** 10;

/** A fresh temp-file token for one write. */
export function writeToken(random: () => number = Math.random): string {
  return Math.floor(random() * YSK_TOKEN_SPACE).toString(36).padStart(10, '0');
}

/** Writes a change tries: the first, and one more against a fresh read when a session wrote in between. */
export const YSK_WRITE_ATTEMPTS = 2;

/**
 * Apply a change to the store, compare-and-swap: written against the version
 * the app read, and when the file changed since (a session wrote it), read
 * once more, applied to what is there now, and tried once more. A second
 * stale answer gives up, since something is writing it faster than a phone
 * can keep up, and the person is told.
 */
export async function changeYouShouldKnow(
  transport: HerdrTransport,
  held: HeldStore,
  change: YskChange,
  token: () => string = writeToken
): Promise<ChangeResult> {
  let current = held;
  for (let attempt = 0; attempt < YSK_WRITE_ATTEMPTS; attempt += 1) {
    const next = change(current.file.raw);
    if (next === null) return { ok: true, changed: false, held: current };
    const written = await writeYouShouldKnow(transport, current.path, current.version, next, token());
    if (written === null) return { ok: false, held: current };
    if (written.kind === 'written') {
      const file = parseYskFile(serializeYsk(next));
      return file === null ? { ok: false, held: current } : { ok: true, changed: true, held: { path: current.path, version: written.version, file } };
    }
    if (attempt === YSK_WRITE_ATTEMPTS - 1) break;
    const fresh = await readYouShouldKnow(transport, current.path, null);
    if (fresh === null || fresh.kind !== 'present') return { ok: false, held: null };
    const file = parseYskFile(fresh.text);
    if (file === null) return { ok: false, held: null };
    current = { path: current.path, version: fresh.version, file };
  }
  return { ok: false, held: current };
}
