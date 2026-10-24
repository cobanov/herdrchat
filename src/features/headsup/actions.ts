import { clearReplied, markReplied, replyPrompt, resolveItem, type HeadsUpChat, type HeadsUpItem } from '@/lib/headsup/items';
import { clientFor, useConnections } from '@/state/connections';
import { changeHostHeadsUp } from '@/state/headsUp';
import { openChat } from '@/features/chats/navigation';

/*
  What the Heads Up screen does to an item, by host. Apart from the store
  because they find the host's client, which brings in the SSH module.

  Each returns null when it worked and otherwise the sentence to show: the
  person tapped something and is waiting on it, so a failure is said.
*/

function clientOf(connectionId: string) {
  const connection = useConnections.getState().connections.find((item) => item.id === connectionId);
  return connection === undefined ? null : { client: clientFor(connection), name: connection.name };
}

const unreachable = (name: string) => `Couldn't update Heads Up on ${name}. Check that it's awake, then try again.`;

/** ✓ and Close: the item is done, as the mod's own resolve marks it. */
export async function resolveHeadsUpItem(connectionId: string, item: HeadsUpItem): Promise<string | null> {
  const host = clientOf(connectionId);
  if (host === null) return "That host isn't in the app any more.";
  return (await changeHostHeadsUp(connectionId, host.client.transport, resolveItem(item.id, Date.now()))) === 'failed' ? unreachable(host.name) : null;
}

/** "Reply again": the item takes a reply once more. */
export async function reopenHeadsUpItem(connectionId: string, item: HeadsUpItem): Promise<string | null> {
  const host = clientOf(connectionId);
  if (host === null) return "That host isn't in the app any more.";
  return (await changeHostHeadsUp(connectionId, host.client.transport, clearReplied(item.id))) === 'failed' ? unreachable(host.name) : null;
}

/**
 * Send a reply to the session that asked, tagged so Claude there resolves the
 * item once it has acted on it. The item is claimed first by marking it
 * replied, and the prompt goes only when this call's mark landed, as the
 * mod's own Reply does: an item already replied to (from the terminal,
 * another phone, a second tap) or resolved since the list was read sends
 * nothing, and the row shows it as it now is. When the prompt does not go,
 * this call's mark comes off again, never anyone else's, and the person is
 * told.
 */
export async function replyToHeadsUpItem(
  connectionId: string,
  item: HeadsUpItem,
  chat: HeadsUpChat,
  reply: string
): Promise<string | null> {
  const text = reply.trim();
  if (text === '') return null;
  const host = clientOf(connectionId);
  if (host === null) return "That host isn't in the app any more.";
  const { client } = host;
  const at = Date.now();
  const claimed = await changeHostHeadsUp(connectionId, client.transport, markReplied(item.id, at));
  if (claimed === 'failed') return unreachable(host.name);
  if (claimed === 'unchanged') return 'Already answered, or closed, since the list was read. Nothing more was sent.';
  let sent = false;
  try {
    sent = (await client.sendPrompt(chat.paneId, replyPrompt(item, text))) !== 'stalled';
  } catch {
    sent = false;
  }
  if (sent) return null;
  await changeHostHeadsUp(connectionId, client.transport, clearReplied(item.id, at));
  return `The reply didn't reach the ${item.folder || 'Claude'} session. Try again, or use Go to answer in its chat.`;
}

/** Go: the chat that raised the item, as the list opens it. */
export function goToHeadsUpChat(connectionId: string, chat: HeadsUpChat): void {
  openChat(connectionId, chat.workspaceId, undefined, chat.soleAgent ? undefined : chat.paneId);
}
