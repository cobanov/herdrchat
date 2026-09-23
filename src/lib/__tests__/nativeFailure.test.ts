import { HOST_KEY_CHANGED_MESSAGE, friendlyFailure, friendlyMessage } from '../herdr/nativeFailure';

// Library words reached the screen as they were (#4 acceptance).
describe('native failure wording', () => {
  it.each([
    ['transport_failed', 'Broken transport; encountered EOF', /connection to the host dropped/],
    ['transport_failed', "The operation couldn't be completed. (NIOCore.ChannelError error 7.)", /connection to the host dropped/],
    ['connect_failed', 'java.net.ConnectException: Connection refused', /Nothing accepted the connection/],
    ['connect_failed', 'java.net.SocketException: something odd', /Couldn't reach the host/],
    ['connect_failed', '', /Couldn't reach the host/],
    // Seen on Android (sshj) and iOS (NIO) for a port nothing listens on.
    ['connect_failed', 'failed to connect to /10.0.2.2 (port 22264) from /10.0.2.16 (port 43328) after 15000ms: isConnected failed: ECONNREFUSED (Connection refused)', /Nothing accepted the connection/],
    ['connect_failed', "The operation couldn't be completed. (NIOPosix.NIOConnectionError error 1.)", /Nothing accepted the connection/],
    ['connect_failed', 'java.net.UnknownHostException: Unable to resolve host "mini"', /Couldn't find that host name/],
  ])('rewrites %s "%s"', (code, message, expected) => {
    expect(friendlyMessage(code, message)).toMatch(expected);
  });

  it('keeps a message that is already a sentence for people', () => {
    const own = 'The server rejected these credentials. Check the username and the key or password.';
    expect(friendlyMessage('auth_failed', own)).toBe(own);
    expect(friendlyMessage('connect_failed', "Couldn't reach 10.0.0.2.")).toBe("Couldn't reach 10.0.0.2.");
  });

  it('says what a changed host key means, calmly and the same on both platforms', () => {
    expect(friendlyMessage('host_key_changed', "The server's SSH key DIFFERS from the saved one")).toBe(HOST_KEY_CHANGED_MESSAGE);
  });

  it('keeps the code and any other fields', () => {
    expect(friendlyFailure({ ok: false as const, code: 'transport_failed', message: 'EOF' })).toEqual({
      ok: false,
      code: 'transport_failed',
      message: expect.stringContaining('dropped'),
    });
  });
});
