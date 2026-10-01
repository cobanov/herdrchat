/**
 * What the chat list says while the first poll of a host is out.
 *
 * A reachable host answers in a second or two. Past that, the usual cause is
 * not the app: the phone is off the tailnet (Tailscale switched off, or a
 * VPN on demand that has not come up), or the computer is asleep. The poll
 * itself waits `POLL_TIMEOUT_MS` before it can say so, so the list says it
 * first, while there is still a reason to look at it.
 */

/** How long a connection is ordinary before the list explains what may be wrong. */
export const SLOW_CONNECT_MS = 4000;

/** The host a person would recognise: its name, or its address when unnamed. */
export function connectingTitle(host: { name: string; host: string }): string {
  const name = host.name.trim().length > 0 ? host.name.trim() : host.host;
  return `Connecting to ${name}…`;
}
