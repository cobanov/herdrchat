/**
 * Heads Up's round-trips, over any transport: detect, read, and change.
 *
 * None of them throws. Detecting and reading are side tasks of the chat
 * list's poll, so a failure is worth one bit (null: keep what you have, try
 * again later); a change is something the person did and is waiting on, so
 * it says whether it happened.
 */
import { POLL_TIMEOUT_MS, SEND_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import {
  HEADSUP_MAX_BYTES,
  headsUpDetectCommand,
  headsUpReadCommand,
  headsUpWriteCommands,
  parseHeadsUpDetect,
  parseHeadsUpRead,
  parseHeadsUpWrite,
  utf8Bytes,
  type HeadsUpDetect,
  type HeadsUpRead,
  type HeadsUpWrite,
} from './command';
import { parseHeadsUpFile, serializeHeadsUp, type HeadsUpChange, type HeadsUpFile } from './items';

/**
 * How often the chat list's poll looks for the store, once it has looked:
 * the slash commands' cadence. A host gets the mod when someone installs it,
 * which is rare; ten minutes notices that the same session, and a pull to
 * refresh sooner.
 */
export const HEADSUP_DETECT_INTERVAL_MS = 600_000;

/**
 * How often the poll reads the list while the chats are on screen: the host
 * theme's cadence. Sessions write it as they ask and fail; ten seconds keeps
 * the bar current for a line of traffic when nothing moved.
 */
export const HEADSUP_READ_INTERVAL_MS = 10_000;

export function headsUpDetectDue(lastDetect: number | null, now: number): boolean {
  return lastDetect === null || now - lastDetect >= HEADSUP_DETECT_INTERVAL_MS;
}

export function headsUpReadDue(lastRead: number | null, now: number): boolean {
  return lastRead === null || now - lastRead >= HEADSUP_READ_INTERVAL_MS;
}

async function run(transport: HerdrTransport, command: string, timeoutMs: number): Promise<string | null> {
  try {
    const result = await transport.exec(command, timeoutMs);
    return result.ok && result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

/** Where the store is, that there is none, or null for a failed check. */
export async function detectHeadsUp(transport: HerdrTransport): Promise<HeadsUpDetect | null> {
  const stdout = await run(transport, headsUpDetectCommand(), POLL_TIMEOUT_MS);
  return stdout === null ? null : parseHeadsUpDetect(stdout);
}

/** The store, read against the version held. Null for a failed read. */
export async function readHeadsUp(transport: HerdrTransport, path: string, lastVersion: string | null): Promise<HeadsUpRead | null> {
  const stdout = await run(transport, headsUpReadCommand(path, lastVersion), POLL_TIMEOUT_MS);
  return stdout === null ? null : parseHeadsUpRead(stdout, lastVersion);
}

/** Write `raw` over the store if it still has `version`. Null for a failed write. */
export async function writeHeadsUp(
  transport: HerdrTransport,
  path: string,
  version: string,
  raw: Record<string, unknown>,
  token: string
): Promise<HeadsUpWrite | null> {
  const json = serializeHeadsUp(raw);
  if (utf8Bytes(json) > HEADSUP_MAX_BYTES) return null;
  let stdout: string | null = null;
  for (const command of headsUpWriteCommands(path, version, json, token)) {
    stdout = await run(transport, command, SEND_TIMEOUT_MS);
    if (stdout === null) return null;
  }
  return stdout === null ? null : parseHeadsUpWrite(stdout);
}

/** The store as the app holds it: where, which version, and what it said. */
export interface HeldStore {
  path: string;
  version: string;
  file: HeadsUpFile;
}

export type ChangeResult =
  /** Written, or nothing to write; `held` is the store as it now is. */
  | { ok: true; held: HeldStore }
  /** Not written: the host could not be reached, or the file kept changing under it. */
  | { ok: false; held: HeldStore | null };

/** A fresh temp-file token for one write. */
export function writeToken(random: () => number = Math.random): string {
  return Math.floor(random() * 36 ** 10).toString(36).padStart(10, '0');
}

/**
 * Apply a change to the store, compare-and-swap: written against the version
 * the app read, and when the file changed since (a session wrote it), read
 * once more, applied to what is there now, and tried once more. A second
 * stale answer gives up, since something is writing it faster than a phone
 * can keep up, and the person is told.
 */
export async function changeHeadsUp(
  transport: HerdrTransport,
  held: HeldStore,
  change: HeadsUpChange,
  token: () => string = writeToken
): Promise<ChangeResult> {
  let current = held;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = change(current.file.raw);
    if (next === null) return { ok: true, held: current };
    const written = await writeHeadsUp(transport, current.path, current.version, next, token());
    if (written === null) return { ok: false, held: current };
    if (written.kind === 'written') {
      const file = parseHeadsUpFile(serializeHeadsUp(next));
      return file === null ? { ok: false, held: current } : { ok: true, held: { path: current.path, version: written.version, file } };
    }
    if (attempt === 1) break;
    const fresh = await readHeadsUp(transport, current.path, null);
    if (fresh === null || fresh.kind !== 'present') return { ok: false, held: null };
    const file = parseHeadsUpFile(fresh.text);
    if (file === null) return { ok: false, held: null };
    current = { path: current.path, version: fresh.version, file };
  }
  return { ok: false, held: current };
}
