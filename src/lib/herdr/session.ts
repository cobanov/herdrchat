import { shellQuote } from './shell';
import type { HerdrTransport } from './transport';

/**
 * herdr's default session name. Setting `HERDR_SESSION` to this is the same as
 * not setting it, so we don't — an env var that says "default" is noise in every
 * command the host logs.
 */
export const DEFAULT_SESSION = 'default';

/**
 * Whether a stored session name means anything.
 *
 * Empty, whitespace and "default" all mean the same thing: leave the variable
 * unset and let herdr resolve it.
 */
export function isNamedSession(name: string | null | undefined): name is string {
  const trimmed = name?.trim() ?? '';
  return trimmed.length > 0 && trimmed !== DEFAULT_SESSION;
}

/**
 * Bind a transport to a named herdr session.
 *
 * On a host running more than one session we previously drove whichever the
 * default resolved to, with nothing on screen saying the others existed.
 *
 * WRAPPING THE TRANSPORT, not adding a parameter to `withPath`. The obvious fix
 * is a second argument on the command builder, and it is the wrong one: there
 * are eight call sites — the client, the transcript store, the push
 * registration — and "every caller passes the session" is precisely the
 * forgetting this is meant to prevent. A transport is already one per
 * connection, and everything reaches the host through `exec` or `streamLines`,
 * so binding it here means a new call site cannot get it wrong because it never
 * has to get it right.
 *
 * The identity case returns the original object rather than a wrapper: with no
 * named session there is nothing to add, and an extra layer would show up in
 * every stack trace for no reason.
 */
export function withSession(
  transport: HerdrTransport,
  sessionName: string | null | undefined
): HerdrTransport {
  if (!isNamedSession(sessionName)) return transport;
  const prefix = `export HERDR_SESSION=${shellQuote(sessionName.trim())}; `;

  return {
    exec: (command, timeoutMs) => transport.exec(prefix + command, timeoutMs),
    streamLines: (command, startTimeoutMs) =>
      transport.streamLines(prefix + command, startTimeoutMs),
  };
}
