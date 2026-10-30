import * as Linking from 'expo-linking';

import { chatKey } from '@/lib/chatKey';
import { noteDraft } from '@/lib/youShouldKnow/draft';
import { dismissNote, knowNote, learnMore, type Note, type NoteChat, type YskChange } from '@/lib/youShouldKnow/notes';
import { clientFor, useConnections } from '@/state/connections';
import { draftKey, useDrafts } from '@/state/drafts';
import { changeHostNotes } from '@/state/youShouldKnow';
import { openChat } from '@/features/chats/navigation';

/*
  What the phone does to a note, by host. Apart from the store because they
  find the host's client, which brings in the SSH module.

  Each returns null when it worked and otherwise the sentence to show: the
  person tapped something and is waiting on it, so a failure is said. A note
  the terminal has meanwhile moved on (answered at the computer, or cleared
  after two prompts) is not a failure: the next read shows it as it now is.
*/

function hostOf(connectionId: string) {
  const connection = useConnections.getState().connections.find((item) => item.id === connectionId);
  return connection === undefined ? null : { client: clientFor(connection), name: connection.name };
}

const unreachable = (name: string) => `Couldn't update the note on ${name}. Check that it's awake, then try again.`;

async function change(connectionId: string, update: YskChange | null): Promise<string | null> {
  if (update === null) return null;
  const host = hostOf(connectionId);
  if (host === null) return "That host isn't in the app any more.";
  return (await changeHostNotes(connectionId, host.client.transport, update)) === 'failed' ? unreachable(host.name) : null;
}

/** Learn more: the explanation the side agent wrote shows, here and in the terminal. */
export function learnMoreAbout(connectionId: string, note: Note): Promise<string | null> {
  return change(connectionId, learnMore(note, Date.now()));
}

/** Knew this already, and Understood: the line joins what the side agent steers clear of, and the note goes. */
export function knowAbout(connectionId: string, note: Note): Promise<string | null> {
  return change(connectionId, knowNote(note));
}

/** Dismiss: the note goes. */
export function dismissAbout(connectionId: string, note: Note): Promise<string | null> {
  return change(connectionId, dismissNote(note));
}

/**
 * Discuss in chat, from a chat's own bar: the note's draft in the composer
 * (`fill`, replacing what was there), then what the terminal's "Chat in main
 * session" does next, the line to `known` and the note away, so it leaves
 * the bar while the person types.
 */
export function discussHere(connectionId: string, note: Note, fill: (draft: string) => void): Promise<string | null> {
  fill(noteDraft(note));
  return knowAbout(connectionId, note);
}

/** Go: the note's chat, as the list opens it. */
export function goToNoteChat(connectionId: string, chat: NoteChat): void {
  openChat(connectionId, chat.workspaceId, chat.title, chat.soleAgent ? undefined : chat.paneId);
}

/**
 * Discuss in chat, from the notes screen: the chat's composer holds the
 * draft when it opens, as if typed there, and the note goes.
 */
export function discussInChat(connectionId: string, note: Note, chat: NoteChat): Promise<string | null> {
  const key = draftKey(connectionId, chatKey({ workspaceId: chat.workspaceId, paneId: chat.soleAgent ? null : chat.paneId }));
  // No session signature: the chat is opened now, on the session the note is for.
  useDrafts.getState().save(key, noteDraft(note), null);
  goToNoteChat(connectionId, chat);
  return knowAbout(connectionId, note);
}

/** A learning page the terminal published, in the browser. */
export async function openLearningPage(url: string): Promise<string | null> {
  try {
    await Linking.openURL(url);
    return null;
  } catch {
    return "Couldn't open the learning page.";
  }
}
