import { DemoHost } from '@/lib/demo/host';
import { HerdrClient } from '@/lib/herdr/client';
import { checkHeadsUp, headsUpOf, resetHeadsUpSession } from '@/state/headsUp';
import { goToHeadsUpChat, replyToHeadsUpItem, resolveHeadsUpItem } from '../actions';

const T0 = Date.parse('2026-10-24T12:00:00Z');
let mockClient: HerdrClient;
jest.mock('@/state/connections', () => ({
  clientFor: () => mockClient,
  useConnections: { getState: () => ({ connections: [{ id: 'demo', name: 'Demo' }] }) },
}));
const mockOpenChat = jest.fn();
jest.mock('@/features/chats/navigation', () => ({ openChat: (...args: unknown[]) => mockOpenChat(...args) }));

const NOTES_CHAT = { sessionId: '22222222-2222-4222-8222-222222222222', workspaceId: 'w2', paneId: 'w2:p1', soleAgent: true };

async function setUp() {
  resetHeadsUpSession();
  const host = new DemoHost(() => T0);
  host.setUpHeadsUp('w2:p1');
  mockClient = new HerdrClient(host);
  await checkHeadsUp('demo', host, { now: T0 });
  const item = (id: string) => headsUpOf('demo').file!.items.find((one) => one.id === id)!;
  return { host, item };
}

it('sends the tagged reply to the chat that asked, and marks the item replied', async () => {
  const { item } = await setUp();
  const send = jest.spyOn(mockClient, 'sendPrompt');
  await expect(replyToHeadsUpItem('demo', item('demohu1q'), NOTES_CHAT, ' Keep it as a draft ')).resolves.toBeNull();
  expect(send).toHaveBeenCalledWith('w2:p1', 'Re: "Publish the release notes, or keep them as a draft?" [demohu1q]\nKeep it as a draft');
  expect(item('demohu1q')).toMatchObject({ status: 'open' });
  expect(item('demohu1q').repliedAt).not.toBeNull();
});

it('takes the mark back off and says so when the reply does not go', async () => {
  const { item } = await setUp();
  jest.spyOn(mockClient, 'sendPrompt').mockRejectedValue(new Error('pane gone'));
  await expect(replyToHeadsUpItem('demo', item('demohu1q'), NOTES_CHAT, 'Yes')).resolves.toMatch(/didn't reach the notes session/);
  expect(item('demohu1q').repliedAt).toBeNull();
});

it('sends nothing for an empty reply', async () => {
  const { item } = await setUp();
  const send = jest.spyOn(mockClient, 'sendPrompt');
  await expect(replyToHeadsUpItem('demo', item('demohu1q'), NOTES_CHAT, '   ')).resolves.toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it('resolves an item on the host', async () => {
  const { host, item } = await setUp();
  await expect(resolveHeadsUpItem('demo', item('demohu5n'))).resolves.toBeNull();
  expect(JSON.parse(host.headsUpText()!).items.find((one: { id: string }) => one.id === 'demohu5n')).toMatchObject({ status: 'done' });
});

it('opens a lone agent’s chat as the workspace’s, and one of several by its pane', () => {
  goToHeadsUpChat('demo', NOTES_CHAT);
  expect(mockOpenChat).toHaveBeenLastCalledWith('demo', 'w2', undefined, undefined);
  goToHeadsUpChat('demo', { ...NOTES_CHAT, workspaceId: 'w6', paneId: 'w6:p2', soleAgent: false });
  expect(mockOpenChat).toHaveBeenLastCalledWith('demo', 'w6', undefined, 'w6:p2');
});
