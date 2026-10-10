import { HerdrClient } from '../herdr/client';
import { DemoHost } from '../demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '../demo/fixtures';
import { TranscriptStore } from '../transcript/store';

async function messages(host: DemoHost) {
  const store = new TranscriptStore(host);
  const workspace = DEMO_WORKSPACES[1]!;
  const path = store.sessionTranscriptPath(await store.homeDirectory(), workspace.cwd, DEMO_SESSION_IDS[workspace.paneId]!)!;
  return (await store.recent(path, 'claude', 262_144)).messages;
}

// What a palette pick sends, on the host the UI tests run against.
describe('the Demo running a picked command', () => {
  it('runs a command file as a prompt: the command, then the agent’s answer', async () => {
    let now = 1_000;
    const host = new DemoHost(() => now);
    const client = new HerdrClient(host);
    await client.sendCommand('w2:p1', '/review 42');
    const sent = (await messages(host)).at(-1)!;
    expect(sent.role).toBe('user');
    expect(JSON.stringify(sent.segments)).toContain('/review');

    now += 10_000;
    const answered = (await messages(host)).at(-1)!;
    expect(answered.role).toBe('assistant');
    expect(JSON.stringify(answered.segments)).toContain('This is the demo host');
  });

  it('runs a built-in that takes nothing at once, leaving a command note', async () => {
    const host = new DemoHost();
    const client = new HerdrClient(host);
    await client.sendCommand('w2:p1', '/usage');
    const last = (await messages(host)).slice(-2);
    expect(last.map((message) => message.role)).toEqual(['user', 'system']);
    expect(JSON.stringify(last[1]!.segments)).toContain('/usage did nothing here');
  });
});
