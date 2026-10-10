/**
 * The host theme's three round-trips, over any transport: check for a new
 * theme.json, write the reference files beside it, and move it aside.
 *
 * None of them throws and none of them reports a reason. Each is a side task
 * of something else (the chat list's poll, a Settings button), so a failure is
 * worth exactly one bit to its caller: try again later, or tell the person it
 * did not work. A host that is down already says so through the poll it rides
 * on.
 */
import { POLL_TIMEOUT_MS, SEND_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import { bootstrapCommand } from './bootstrap';
import { afterFetch, knownMtime, parseThemeFetch, themeFetchCommand, themeResetCommand } from './hostTheme';
import type { HostThemeFile } from './resolve';

/**
 * How often the chat list's poll also checks the theme.
 *
 * The poll itself runs every 3 s; checking each time would be one more
 * round-trip per tick for a file that changes when someone asks an agent to
 * restyle the app. Ten seconds keeps that change feeling prompt while costing
 * a third of the list's traffic at most, and a few bytes when nothing moved.
 */
export const HOST_THEME_CHECK_INTERVAL_MS = 10_000;

/** Whether a check is due, given when the last one started (null: never, or asked for). */
export function themeCheckDue(lastCheck: number | null, now: number): boolean {
  return lastCheck === null || now - lastCheck >= HOST_THEME_CHECK_INTERVAL_MS;
}

/**
 * Ask the host whether theme.json changed since `held`, and return the file
 * as it now is (`held` itself when unchanged, so a caller can compare by
 * identity). `force` sends no mtime, so the contents come back regardless.
 *
 * Null is a failed check: the command did not run, exited badly, or printed
 * something the parser does not recognise. The caller keeps what it has.
 */
export async function fetchHostTheme(
  transport: HerdrTransport,
  held: HostThemeFile,
  { force = false }: { force?: boolean } = {}
): Promise<HostThemeFile | null> {
  const last = force ? null : knownMtime(held);
  try {
    const result = await transport.exec(themeFetchCommand(last), POLL_TIMEOUT_MS);
    if (!result.ok || result.exitCode !== 0) return null;
    const parsed = parseThemeFetch(result.stdout, last);
    return parsed === null ? null : afterFetch(held, parsed);
  } catch {
    return null;
  }
}

/**
 * Write the schema, the README and the example next to where theme.json goes,
 * leaving any that already exist alone. True when the command succeeded.
 */
export async function bootstrapHostTheme(transport: HerdrTransport): Promise<boolean> {
  try {
    const result = await transport.exec(bootstrapCommand(), POLL_TIMEOUT_MS);
    return result.ok && result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Move theme.json aside to a backup name (see `themeResetCommand`). A person pressed a button for this
 * and is waiting, so it gets a send's deadline rather than a poll's.
 */
export async function resetHostTheme(transport: HerdrTransport): Promise<boolean> {
  try {
    const result = await transport.exec(themeResetCommand(), SEND_TIMEOUT_MS);
    return result.ok && result.exitCode === 0;
  } catch {
    return false;
  }
}
