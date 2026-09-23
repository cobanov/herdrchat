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
  /exception|\bEOF\b|NIO|Error Domain|java\.|sshj|errno|ChannelError|SSHClient|NSPOSIX|Broken transport|\b\w+\.\w+Error\b/i;

export function friendlyMessage(code: string, message: string): string {
  if (code === 'host_key_changed') return HOST_KEY_CHANGED_MESSAGE;
  if (message.trim().length > 0 && !LOOKS_INTERNAL.test(message)) return message;
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
