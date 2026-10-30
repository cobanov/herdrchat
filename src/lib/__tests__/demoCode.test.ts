import { HerdrClient } from '../herdr/client';
import { DemoHost } from '../demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '../demo/fixtures';
import { DEMO_CODE_REPLY, DEMO_PHRASES } from '../demo/scenarios';
import { copyOptions } from '../messageCopy';
import { displayText } from '../transcript/message';
import { TranscriptStore } from '../transcript/store';

// The Demo plays the reply regression/thread copies code from: two blocks,
// each its own row in the sheet and its own Copy in the message.
it('answers "show me the commands" with a reply holding two code blocks', async () => {
  let now = Date.parse('2026-10-30T12:00:00Z');
  const host = new DemoHost(() => now);
  await new HerdrClient(host).sendPrompt('w2:p1', DEMO_PHRASES.code);
  now += 2_000;

  const store = new TranscriptStore(host);
  const workspace = DEMO_WORKSPACES[1]!;
  const path = store.sessionTranscriptPath(await store.homeDirectory(), workspace.cwd, DEMO_SESSION_IDS[workspace.paneId]!);
  const reply = (await store.recent(path!, 'claude', 262_144)).messages.at(-1)!;

  expect(displayText(reply)).toBe(DEMO_CODE_REPLY);
  expect(copyOptions(reply).blocks).toEqual([
    { label: 'sh: git status --short', content: 'git status --short' },
    { label: 'json: {"theme": "dark"}', content: '{"theme": "dark"}' },
  ]);
});
