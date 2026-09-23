/**
 * What a native SSH failure says to a person.
 *
 * The native layers pass their libraries' own words through: sshj's "Broken
 * transport; encountered EOF", NIO's "The operation couldn't be completed.
 * (NIOCore.ChannelError error 7.)". They reached the screen as they were (#4
 * acceptance). The codes are right and stay; a message that reads like an
 * exception becomes a sentence about what happened and what to do.
 */

export const HOST_KEY_CHANGED_MESSAGE =
  "This host's SSH key has changed since you saved it. A reinstalled machine does that, and so would someone " +
  'intercepting the connection. If you expect the change, edit the host and trust the new key.';

const LOOKS_INTERNAL =
  /exception|\bEOF\b|NIO|Error Domain|java\.|sshj|errno|ChannelError|SSHClient|NSPOSIX|Broken transport|\b\w+\.\w+Error\b|\bE[A-Z]{4,}\b|isConnected|failed to connect to|after \d+ms/i;

/** Library texts that name a cause worth its own sentence. */
const CAUSES: readonly [RegExp, string][] = [
  [
    /ECONNREFUSED|Connection refused|NIOConnectionError error 1\b/i,
    'Nothing accepted the connection at that address and port. Check the port, and that SSH (Remote Login on a Mac) is turned on there.',
  ],
  [
    /UnknownHost|Unable to resolve host|nodename nor servname|No address associated|NXDOMAIN/i,
    "Couldn't find that host name. Check the address, and that this phone is on the tailnet.",
  ],
  [
    /ETIMEDOUT|timed out|EHOSTUNREACH|ENETUNREACH|No route to host|Network is unreachable/i,
    "The host didn't answer. Check that it's awake and on the tailnet, and that this phone is too.",
  ],
];

export function friendlyMessage(code: string, message: string): string {
  if (code === 'host_key_changed') return HOST_KEY_CHANGED_MESSAGE;
  if (message.trim().length > 0 && !LOOKS_INTERNAL.test(message)) return message;
  if (code === 'connect_failed' || code === 'transport_failed' || code === 'timeout') {
    const cause = CAUSES.find(([pattern]) => pattern.test(message));
    if (cause !== undefined) return cause[1];
  }
  switch (code) {
    case 'connect_failed':
      return "Couldn't reach the host. Check that it's awake and on the tailnet, and that the address and port are right.";
    case 'transport_failed':
      return 'The connection to the host dropped. It reconnects on its own; try again in a moment.';
    case 'timeout':
      return "The host didn't answer in time. Check that it's awake and on the tailnet.";
    default:
      return message.trim().length > 0 ? message : 'The connection to the host failed.';
  }
}

export function friendlyFailure<T extends { code: string; message: string }>(failure: T): T {
  const message = friendlyMessage(failure.code, failure.message);
  return message === failure.message ? failure : { ...failure, message };
}
