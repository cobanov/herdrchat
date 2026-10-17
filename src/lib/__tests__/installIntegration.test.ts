import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { HerdrClient } from '../herdr/client';
import type { HerdrTransport } from '../herdr/transport';

function host(result: ExecResult): HerdrTransport {
  return { exec: async () => result, streamLines: async function* () {} };
}

// herdr 0.9.5 answers a successful install in plain text. The banner read it as
// "The host's reply wasn't JSON" and never went away, though the install had worked.
it('takes herdr\'s plain-text answer to a successful install as success', async () => {
  const client = new HerdrClient(host({
    ok: true, exitCode: 0, stdout: 'installed pi integration to /Users/me/.pi/agent/extensions/herdr-agent-state.ts\n', stderr: '',
  }));
  await expect(client.installIntegration('pi')).resolves.toBeUndefined();
});

it('still reports an error envelope', async () => {
  const client = new HerdrClient(host({
    ok: true, exitCode: 0, stdout: '{"error":{"code":"unknown_target","message":"no such integration"}}', stderr: '',
  }));
  await expect(client.installIntegration('pi')).rejects.toThrow('no such integration');
});

it('still fails on a non-zero exit', async () => {
  const client = new HerdrClient(host({ ok: true, exitCode: 1, stdout: '', stderr: 'permission denied' }));
  await expect(client.installIntegration('pi')).rejects.toThrow();
});
